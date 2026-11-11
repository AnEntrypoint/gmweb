#!/usr/bin/env node
// Re-validate docs/RELEASE_READINESS.json against live files/gates. Offline.
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = join(ROOT, 'docs/RELEASE_READINESS.json');
const MD_PATH = join(ROOT, 'docs/RELEASE_READINESS.md');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function sha(path) { return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'UNAVAILABLE'; }
function run(command, args) { return spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 }); }
ok('release readiness JSON exists', existsSync(JSON_PATH));
ok('release readiness Markdown exists', existsSync(MD_PATH));
if (!existsSync(JSON_PATH) || !existsSync(MD_PATH)) { console.log('0/2 release-readiness validation checks passed'); process.exit(1); }
const artifact = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const md = readFileSync(MD_PATH, 'utf8');
const gmSha = sha('/workspace/gm/scripts/install.sh');
const vendoredSha = sha(join(ROOT, 'docker/install-gm.sh'));
ok('artifact ok true', artifact.ok === true);
ok('artifact generatedAt parseable', typeof artifact.generatedAt === 'string' && !Number.isNaN(Date.parse(artifact.generatedAt)));
ok('artifact rolloutAction is READY', /^READY:/.test(artifact.rolloutAction || ''));
ok('markdown states ok true and READY', /ok: true/.test(md) && /READY:/.test(md));
ok('artifact installer hashes and parity are live', artifact.gm?.installerSha256 === gmSha && artifact.gmweb?.vendoredInstallerSha256 === vendoredSha && gmSha === vendoredSha && artifact.installerByteParity === true);
ok('artifact live post-restart UNAVAILABLE allowed', ['UNAVAILABLE', 'LIVE_VERIFIED'].includes(artifact.livePostRestart));
ok('artifact commands all passed or UNAVAILABLE', Array.isArray(artifact.commands) && artifact.commands.every((c) => ['PASS', 'UNAVAILABLE'].includes(c.status)), JSON.stringify(artifact.commands?.filter((c) => !['PASS','UNAVAILABLE'].includes(c.status)).map((c) => c.label)));
ok('artifact contains expected command labels', ['root-check','startup-check','runtime-install','container-path','rollout-docs','post-restart-offline','post-restart-live','gm-drift-watch-once','probe-selftest','probe-fixtures','simulate-startup','simulation-gate','report-rollout','validate-rollout-report','sha256-parity','git-diff-check','hidden-token-scan','active-forbidden-grep','ps-survivor-scan'].every((label) => artifact.commands.some((c) => c.label === label)));
ok('artifact gate counts include all known totals', ['82/82','38/38','65/65','27/27','22/22','9/9','4/4','16/16','19/19','13/13','71/71'].every((count) => (artifact.gateCounts || []).includes(count)), (artifact.gateCounts || []).join(' '));
ok('artifact source fingerprint matches live files', artifact.sourceFingerprint === (() => {
  const paths = ['docker/install-gm.sh','startup/services/agentgui.js','startup/services/gm-install.js','startup/index.js','startup/config.json','docker/rest-of-startup.sh','docs/POST-RESTART.md','docs/CONTAINER-ROLLOUT.md','GM_INSTALL.md','readme.md','package.json','startup/package.json'];
  return createHash('sha256').update(['/workspace/gm/scripts/install.sh', ...paths].map((p) => `${p}:${sha(p.startsWith('/') ? p : join(ROOT, p))}`).join('\n')).digest('hex');
})());
ok('artifact has no side-effect contradiction', (artifact.guarantees || []).includes('no network') && (artifact.guarantees || []).includes('no real install') && (artifact.guarantees || []).includes('no MCP registration overwrite') && (artifact.guarantees || []).includes('no restart') && (artifact.guarantees || []).includes('no publish'));
const drift = run(process.execPath, ['scripts/check-gm-upstream-drift.mjs']);
ok('gm drift still clean', Number(drift.status) === 0 && /GM_DRIFT_OK/.test(drift.stdout || ''));
const token = run(process.execPath, ['startup/check-hidden-tokens.mjs']);
ok('hidden-token scan still clean', Number(token.status) === 0 && /no hidden-token matches/.test(token.stdout || ''));
const survivors = run(process.execPath, ['startup/check-survivors.mjs']);
ok('no survivor processes', Number(survivors.status) === 0);
const activeGrep = run('grep', ['-RInE', 'agentgui@1\\.0\\.1126|agentgui@latest|bunx.*agentgui@|npx -y agentgui', 'startup', 'docker', 'Dockerfile', 'Dockerfile.headless', '--exclude=check-*.mjs', '--exclude=validate-*.mjs', '--exclude=rollout-report.mjs', '--exclude=live-post-restart-probe.mjs', '--exclude=gm-install.log']);
ok('active forbidden grep has no matches', Number(activeGrep.status) === 1, `exit=${activeGrep.status}`);
ok('rollout report schema is 4', (() => { try { return JSON.parse(readFileSync(join(ROOT, 'docs/ROLLOUT_REPORT.json'), 'utf8')).schema >= 4; } catch { return false; } })());
for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} release-readiness validation checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('RELEASE_READINESS_VALID ok=true path=docs/RELEASE_READINESS.json');
