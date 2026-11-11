#!/usr/bin/env node
// Single bounded release-readiness gate. Runs every deterministic check once,
// stops on the first real failure, and writes one decision artifact.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const once = argv.includes('--once');
const watch = argv.includes('--watch');
const INTERVAL_MS = Math.min(60000, Math.max(1000, Number(process.env.GMWEB_RELEASE_WATCH_INTERVAL_MS || 20000)));
const DURATION_MS = once ? 0 : Math.min(600000, Math.max(INTERVAL_MS, Number(process.env.GMWEB_RELEASE_WATCH_DURATION_MS || 600000)));
const GM_SOURCE = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const ART_JSON = join(ROOT, 'docs/RELEASE_READINESS.json');
const ART_MD = join(ROOT, 'docs/RELEASE_READINESS.md');
const commands = [
  { label: 'root-check', argv: ['npm', ['run', 'check']] },
  { label: 'startup-check', argv: ['npm', ['--prefix', 'startup', 'run', 'check']] },
  { label: 'runtime-install', argv: [process.execPath, ['startup/check-runtime-install.mjs']] },
  { label: 'container-path', argv: [process.execPath, ['startup/check-container-startup-path.mjs']] },
  { label: 'rollout-docs', argv: [process.execPath, ['scripts/check-rollout-docs.mjs']] },
  { label: 'post-restart-offline', argv: [process.execPath, ['startup/check-post-restart.mjs', '--offline']] },
  { label: 'post-restart-live', argv: [process.execPath, ['startup/check-post-restart.mjs', '--live']], allowUnavailable: true },
  { label: 'gm-drift-watch-once', argv: [process.execPath, ['scripts/check-gm-upstream-drift.mjs', '--watch', '--once']] },
  { label: 'probe-selftest', argv: ['npm', ['run', 'probe:post-restart']] },
  { label: 'probe-fixtures', argv: [process.execPath, ['startup/check-live-probe-fixtures.mjs']] },
  { label: 'simulate-startup', argv: ['npm', ['run', 'simulate:startup']] },
  { label: 'simulation-gate', argv: [process.execPath, ['startup/check-simulated-startup.mjs']] },
  { label: 'report-rollout', argv: ['npm', ['run', 'report:rollout']] },
  { label: 'validate-rollout-report', argv: ['npm', ['run', 'validate:rollout-report']] },
  { label: 'sha256-parity', argv: ['sha256sum', ['docker/install-gm.sh', GM_SOURCE]], parity: true },
  { label: 'node-check-js', argv: [process.execPath, ['--check', 'startup/check-release-readiness.mjs']] },
  { label: 'bash-n-start', argv: ['bash', ['-n', 'startup/start.sh']] },
  { label: 'bash-n-root-startup', argv: ['bash', ['-n', 'startup.sh']] },
  { label: 'sh-n-installer', argv: ['sh', ['-n', 'docker/install-gm.sh']] },
  { label: 'git-diff-check', argv: ['git', ['diff', '--check']] },
  { label: 'hidden-token-scan', argv: [process.execPath, ['-e', 'const fs=require("fs");const r=/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|X-Amz-(Algorithm|Credential|Signature)|-----BEGIN .*PRIVATE KEY-----/i;const p="docs/RELEASE_READINESS.json";if(fs.existsSync(p)&&r.test(fs.readFileSync(p,"utf8")))process.exit(1)']] },
  { label: 'active-forbidden-grep', argv: ['grep', ['-RInE', 'agentgui@1\\.0\\.1126|agentgui@latest|bunx.*agentgui@|npx -y agentgui', 'startup', 'docker', 'Dockerfile', 'Dockerfile.headless', '--exclude=check-*.mjs', '--exclude=validate-*.mjs', '--exclude=rollout-report.mjs', '--exclude=live-post-restart-probe.mjs', '--exclude=gm-install.log']], expectExit: 1 },
  { label: 'ps-survivor-scan', argv: ['bash', ['-c', "ps -eo pid=,args= | grep -E 'github:AnEntrypoint/agentgui#main|GM_INSTALL_DRY_RUN=1|gmweb-simulated-startup-|check-release-readiness.mjs' | grep -v 'grep -E' > /tmp/gmweb-release-ps.out; test ! -s /tmp/gmweb-release-ps.out"]] },
];
function sha(path) { return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'UNAVAILABLE'; }
function git(cwd, args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? r.stdout.trim() : 'UNAVAILABLE'; }
function fingerprint() {
  const paths = ['docker/install-gm.sh', 'startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/index.js', 'startup/config.json', 'docker/rest-of-startup.sh', 'docs/POST-RESTART.md', 'docs/CONTAINER-ROLLOUT.md', 'GM_INSTALL.md', 'readme.md', 'package.json', 'startup/package.json'];
  return createHash('sha256').update([GM_SOURCE, ...paths].map((p) => `${p}:${sha(p.startsWith('/') ? p : join(ROOT, p))}`).join('\n')).digest('hex');
}
function gateCounts(text) { return [...text.matchAll(/(\d+)\/(\d+) [A-Za-z-]*\s*checks passed/g)].map((m) => `${m[1]}/${m[2]}`); }
function runOnce() {
  const results = [];
  let ok = true;
  for (const step of commands) {
    const [cmd, args] = step.argv;
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const expected = step.expectExit ?? 0;
    const status = step.allowUnavailable && /STATUS=UNAVAILABLE/.test(out) ? 'UNAVAILABLE' : (Number(r.status) === expected ? 'PASS' : 'FAIL');
    let passed = status !== 'FAIL';
    if (step.parity) {
      const hashes = (r.stdout || '').trim().split('\n').map((l) => l.trim().split(/\s+/)[0]);
      passed = passed && hashes.length === 2 && hashes[0] === hashes[1];
    }
    const record = { label: step.label, command: [cmd, ...args].join(' '), exitCode: Number(r.status ?? 1), expectedExit: expected, status, counts: gateCounts(out), outputTail: out.trim().split('\n').slice(-3).join(' | ').slice(0, 600) };
    results.push(record);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${step.label} exit=${record.exitCode} status=${status} counts=${record.counts.join(',')}`);
    if (!passed) { ok = false; break; }
  }
  const gmHead = git('/workspace/gm', ['rev-parse', 'HEAD']);
  const gmStatus = git('/workspace/gm', ['status', '--short']);
  const gmwebHead = git(ROOT, ['rev-parse', 'HEAD']);
  const gmwebStatus = git(ROOT, ['status', '--short']);
  const installerSha256 = sha(GM_SOURCE);
  const vendoredSha256 = sha(join(ROOT, 'docker/install-gm.sh'));
  const artifact = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    ok,
    tool: 'startup/check-release-readiness.mjs',
    sourceFingerprint: fingerprint(),
    gm: { head: gmHead, dirty: gmStatus !== 'UNAVAILABLE' && gmStatus.length > 0, status: gmStatus, installerSha256 },
    gmweb: { head: gmwebHead, dirty: gmwebStatus !== 'UNAVAILABLE' && gmwebStatus.length > 0, status: gmwebStatus, vendoredInstallerSha256: vendoredSha256 },
    installerByteParity: installerSha256 === vendoredSha256,
    gateCounts: [...new Set(results.flatMap((r) => r.counts))],
    commands: results,
    livePostRestart: results.find((r) => r.label === 'post-restart-live')?.status || 'UNAVAILABLE',
    rolloutAction: ok ? 'READY: docker compose restart gmweb (or headless variant) after change is accepted on STARTUP_REF=main' : 'BLOCKED: fix failed command, rerun npm run check:release-readiness',
    guarantees: ['no network', 'no real install', 'no MCP registration overwrite', 'no restart', 'no publish', 'no long-lived service'],
  };
  writeFileSync(ART_JSON, `${JSON.stringify(artifact, null, 2)}\n`);
  const lines = [
    '# gmweb release readiness', '', `Generated: ${artifact.generatedAt}`, `ok: ${ok}`, `rolloutAction: ${artifact.rolloutAction}`,
    `livePostRestart: ${artifact.livePostRestart}`, `installerByteParity: ${artifact.installerByteParity}`, `gm HEAD: ${gmHead}`, `gm installer SHA256: ${installerSha256}`,
    `gmweb vendored installer SHA256: ${vendoredSha256}`, `sourceFingerprint: ${artifact.sourceFingerprint}`, '',
    '## Commands', '', ...results.map((r) => `- ${r.label}: \`${r.command}\` exit=${r.exitCode} status=${r.status} counts=${r.counts.join(',') || 'none'}`),
    '', 'Decision: `ok: true` means every deterministic gate passed. `UNAVAILABLE` for the live post-restart probe is allowed and means no local deployment was reachable.',
    'Artifacts: `docs/RELEASE_READINESS.json` and `docs/RELEASE_READINESS.md`. Validator: `npm run validate:release-readiness`.',
  ];
  if (!ok) lines.push('', '## Failure', '', results.filter((r) => r.status === 'FAIL').map((r) => `- ${r.label}: ${r.outputTail}`).join('\n'));
  writeFileSync(ART_MD, `${lines.join('\n')}\n`);
  console.log(`RELEASE_READINESS ok=${ok} json=docs/RELEASE_READINESS.json md=docs/RELEASE_READINESS.md rolloutAction=${artifact.rolloutAction}`);
  return { ok, fingerprint: artifact.sourceFingerprint };
}
if (watch || once) {
  const started = Date.now();
  let previous = fingerprint();
  let iterations = 0;
  let last = { ok: true, fingerprint: previous };
  for (;;) {
    iterations++;
    const current = fingerprint();
    const changed = current !== previous;
    if (iterations === 1 || changed) last = runOnce();
    previous = current;
    if (once || Date.now() - started >= DURATION_MS) break;
    const sleepMs = Math.min(INTERVAL_MS, Math.max(0, DURATION_MS - (Date.now() - started)));
    if (sleepMs > 0) spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${sleepMs})`], { timeout: sleepMs + 1000 });
  }
  console.log(`RELEASE_WATCH_RESULT once=${once} iterations=${iterations} interval_ms=${INTERVAL_MS} duration_ms=${DURATION_MS} ok=${last.ok} fingerprint=${previous} action=report-only`);
  if (!last.ok) process.exit(1);
} else {
  const result = runOnce();
  if (!result.ok) process.exit(1);
}
