#!/usr/bin/env node
// Generate docs/ROLLOUT_REPORT.json and docs/ROLLOUT_REPORT.md from real,
// offline gate runs. Deterministic except generatedAt and git worktree status.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GM_SOURCE = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const GATES = [
  { name: 'static-source', command: process.execPath, args: ['startup/check-startup-sources.mjs'], countPattern: /(\d+)\/(\d+) checks passed/ },
  { name: 'runtime-install', command: process.execPath, args: ['startup/check-runtime-install.mjs'], countPattern: /(\d+)\/(\d+) runtime checks passed/ },
  { name: 'container-startup-path', command: process.execPath, args: ['startup/check-container-startup-path.mjs'], countPattern: /(\d+)\/(\d+) container-path checks passed/ },
  { name: 'rollout-docs', command: process.execPath, args: ['scripts/check-rollout-docs.mjs'], countPattern: /(\d+)\/(\d+) rollout-docs checks passed/ },
  { name: 'post-restart-offline', command: process.execPath, args: ['startup/check-post-restart.mjs', '--offline'], countPattern: /(\d+)\/(\d+) post-restart checks passed; STATUS=([A-Z_]+)/ },
  { name: 'post-restart-live', command: process.execPath, args: ['startup/check-post-restart.mjs', '--live'], countPattern: /(\d+)\/(\d+) post-restart checks passed; STATUS=([A-Z_]+)/ },
  { name: 'gm-upstream-drift', command: process.execPath, args: ['scripts/check-gm-upstream-drift.mjs'], countPattern: /(\d+)\/(\d+) gm-drift checks passed/ },
  { name: 'live-probe-selftest', command: process.execPath, args: ['startup/live-post-restart-probe.mjs'], countPattern: /PROBE_CHECKS (\d+)\/(\d+)[\s\S]*?STATUS=([A-Z_]+)/ },
  { name: 'live-probe-fixtures', command: process.execPath, args: ['startup/check-live-probe-fixtures.mjs'], countPattern: /(\d+)\/(\d+) live-probe fixture checks passed/ },
  { name: 'simulated-startup', command: process.execPath, args: ['startup/simulate-container-startup.mjs'], countPattern: /(\d+)\/(\d+) simulated-startup checks passed[\s\S]*?SIMULATED_STARTUP_STATUS=([A-Z_]+)/ },
  { name: 'simulated-startup-gate', command: process.execPath, args: ['startup/check-simulated-startup.mjs'], countPattern: /(\d+)\/(\d+) simulated-startup gate checks passed[\s\S]*?SIMULATED_STARTUP_GATE=([A-Z_]+)/ },
];

function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function run(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20000 });
}
function git(cwd, args) { const r = run('git', args, cwd); return r.status === 0 ? r.stdout.trim() : 'UNAVAILABLE'; }
function gate(runResult, gateDef) {
  const out = `${runResult.stdout || ''}\n${runResult.stderr || ''}`;
  const match = out.match(gateDef.countPattern);
  const passed = Number(match?.[1] ?? -1);
  const total = Number(match?.[2] ?? -1);
  const status = match?.[3] || (Number(runResult.status) === 0 ? 'PASS' : 'FAIL');
  return {
    name: gateDef.name,
    command: [gateDef.command, ...gateDef.args].join(' '),
    exitCode: Number(runResult.status ?? 1),
    passed,
    total,
    count: match ? `${passed}/${total}` : 'UNAVAILABLE',
    status,
    ok: Number(runResult.status) === 0 && passed === total && passed > 0,
    failures: match && passed === total ? [] : [out.trim().split('\n').slice(-8).join(' | ')],
  };
}

const results = GATES.map((def) => gate(run(def.command, def.args), def));
const activeAgentGuiSpec = readFileSync(join(ROOT, 'startup/services/agentgui.js'), 'utf8')
  .match(/const AGENTGUI_PACKAGE = '([^']+)'/)?.[1] || 'UNAVAILABLE';
const gmHead = git('/workspace/gm', ['rev-parse', 'HEAD']);
const gmStatus = git('/workspace/gm', ['status', '--short']);
const gmwebHead = git(ROOT, ['rev-parse', 'HEAD']);
const gmwebStatus = git(ROOT, ['status', '--short']);
const upstreamSha = existsSync(GM_SOURCE) ? sha(GM_SOURCE) : 'UNAVAILABLE';
const vendoredSha = sha(join(ROOT, 'docker/install-gm.sh'));
const byteParity = upstreamSha === vendoredSha;
const ok = results.every((r) => r.ok) && byteParity && activeAgentGuiSpec === 'github:AnEntrypoint/agentgui#main';

const report = {
  schema: 4,
  generatedAt: new Date().toISOString(),
  ok,
  generatedBy: 'startup/rollout-report.mjs',
  gmweb: { head: gmwebHead, dirty: gmwebStatus !== 'UNAVAILABLE' && gmwebStatus.length > 0, status: gmwebStatus },
  gm: { head: gmHead, dirty: gmStatus !== 'UNAVAILABLE' && gmStatus.length > 0, status: gmStatus, source: GM_SOURCE, installerSha256: upstreamSha },
  installer: { vendoredPath: 'docker/install-gm.sh', vendoredSha256: vendoredSha, byteParity },
  agentGui: { activeSpec: activeAgentGuiSpec, requiredSpec: 'github:AnEntrypoint/agentgui#main', npmPinsAllowed: false },
  gates: results,
  postRestart: {
    offlineStatus: results.find((r) => r.name === 'post-restart-offline')?.status || 'UNAVAILABLE',
    liveStatus: results.find((r) => r.name === 'post-restart-live')?.status || 'UNAVAILABLE',
    liveEvidence: (results.find((r) => r.name === 'post-restart-live')?.failures || []).join(' '),
  },
  postRestartProbe: {
    selftestCommand: 'npm run probe:post-restart',
    explicitCommand: 'npm run probe:post-restart -- --url <base> --log <path>',
    statuses: ['SELFTEST', 'PASS', 'FAIL', 'UNAVAILABLE'],
    fixtures: { healthy: 'PASS', 'stale-npm-pin': 'FAIL', unreachable: 'UNAVAILABLE' },
    offlineByDefault: true,
    timeoutMsMax: 2000,
    readOnly: true,
  },
  simulatedStartup: {
    command: 'npm run simulate:startup',
    checker: 'node startup/check-simulated-startup.mjs',
    output: 'docs/SIMULATED_STARTUP_OUTPUT.txt',
    status: results.find((r) => r.name === 'simulated-startup')?.status || 'UNAVAILABLE',
    tempDirHandling: 'created under OS temp dir and removed in finally',
    supervisorFirstEvidence: 'SUPERVISOR_READY before detached install resolution',
    gmInstallDryRunEvidence: 'GM_DRY_RUN_EVIDENCE dry_run=1 registration_skipped=1 detached=true',
    agentGuiSpec: 'npx -y github:AnEntrypoint/agentgui#main',
    noNetwork: true,
    cleanup: true,
    timeoutMsMax: 19000,
  },
  releaseReadiness: {
    command: 'npm run check:release-readiness',
    validator: 'npm run validate:release-readiness',
    watchCommand: 'npm run check:release-readiness -- --watch --once',
    artifacts: ['docs/RELEASE_READINESS.json', 'docs/RELEASE_READINESS.md'],
    decision: 'READY only when all deterministic gates pass; UNAVAILABLE live post-restart is allowed',
    offline: true,
    boundedWatch: { durationMsMax: 600000, intervalMs: 20000, modifiesFiles: false },
  },
  rollout: {
    productionCommand: 'docker compose restart gmweb',
    headlessCommand: 'docker compose -f docker-compose.headless.yaml restart gmweb-headless',
    startupRef: 'main',
    reason: 'Container boot re-fetches STARTUP_REF into /opt/gmweb-startup/ before supervisor starts.',
  },
  rollback: 'Revert changed files on main (or deployment STARTUP_REF), then repeat the same container restart.',
  driftAction: `cp ${GM_SOURCE} ${join(ROOT, 'docker/install-gm.sh')}`,
  guarantees: ['no network', 'no real install', 'no MCP registration overwrite', 'no restart', 'no publish', 'no long-lived service'],
  failures: ok ? [] : results.filter((r) => !r.ok).map((r) => `${r.name}: exit=${r.exitCode} count=${r.count} ${r.failures.join(' ')}`),
};

writeFileSync(join(ROOT, 'docs/ROLLOUT_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  '# gmweb rollout report',
  '',
  `Generated: ${report.generatedAt}`,
  `ok: ${ok}`,
  '',
  '## State',
  '',
  `- gmweb HEAD: \`${gmwebHead}\`${report.gmweb.dirty ? ' (dirty worktree)' : ''}`,
  `- gm HEAD: \`${gmHead}\`${report.gm.dirty ? ' (dirty worktree)' : ''}`,
  `- gm installer SHA256: \`${upstreamSha}\``,
  `- gmweb vendored installer SHA256: \`${vendoredSha}\``,
  `- byte parity: ${byteParity}`,
  `- active AgentGUI spec: \`${activeAgentGuiSpec}\``,
  `- offline post-restart: ${report.postRestart.offlineStatus}`,
  `- live post-restart: ${report.postRestart.liveStatus}`,
  `- live probe SELFTEST: ${results.find((r) => r.name === 'live-probe-selftest')?.count || 'UNAVAILABLE'}`,
  `- explicit probe: \`${report.postRestartProbe.explicitCommand}\``,
  `- simulated startup: ${report.simulatedStartup.status} (${results.find((r) => r.name === 'simulated-startup')?.count || 'UNAVAILABLE'})`,
  `- simulation command: \`${report.simulatedStartup.command}\``,
  `- release readiness: \`${report.releaseReadiness.command}\` -> \`${report.releaseReadiness.artifacts[0]}\``,
  '',
  '## Gate counts',
  '',
  ...results.map((r) => `- ${r.name}: ${r.count}, exit=${r.exitCode}, status=${r.status}`),
  '',
  '## Rollout',
  '',
  `- Production: \`${report.rollout.productionCommand}\``,
  `- Headless: \`${report.rollout.headlessCommand}\``,
  `- Rollback: ${report.rollback}`,
  `- Drift action (manual only): \`${report.driftAction}\``,
  '',
  'This report is offline and non-destructive. See `docs/POST-RESTART.md` and `docs/CONTAINER-ROLLOUT.md`.',
];
if (!ok) lines.push('', '## Failures', '', ...report.failures.map((f) => `- ${f}`));
writeFileSync(join(ROOT, 'docs/ROLLOUT_REPORT.md'), `${lines.join('\n')}\n`);
console.log(`ROLLOUT_REPORT ok=${ok} json=docs/ROLLOUT_REPORT.json md=docs/ROLLOUT_REPORT.md gates=${results.map((r) => `${r.name}:${r.count}`).join(' ')}`);
if (!ok) {
  console.error(report.failures.join('\n'));
  process.exit(1);
}
