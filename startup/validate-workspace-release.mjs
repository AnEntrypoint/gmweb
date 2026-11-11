#!/usr/bin/env node
// Deterministic validator for docs/WORKSPACE_RELEASE.json. Offline/read-only.
import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_PATH = join(ROOT, 'docs/WORKSPACE_RELEASE.json');
const MD_PATH = join(ROOT, 'docs/WORKSPACE_RELEASE.md');
const GM_INSTALLER = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function sha(path) { return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null; }
function run(command, args) { return spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 20000 }); }
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

ok('workspace release JSON exists', existsSync(JSON_PATH));
ok('workspace release Markdown exists', existsSync(MD_PATH));
if (!existsSync(JSON_PATH) || !existsSync(MD_PATH)) { console.log('0/2 workspace-release validation checks passed'); process.exit(1); }
const report = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const md = readFileSync(MD_PATH, 'utf8');
ok('workspace release ok true', report.ok === true);
ok('workspace release generatedAt parseable', typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)));
ok('workspace release is read-only', report.mode === 'read-only-peer-artifacts' && (report.guarantees || []).includes('read-only peers') && (report.guarantees || []).includes('no restart'));
ok('workspace release core green', report.core?.gmweb === 'PASS' && report.core?.oscraft === 'PASS' && ['PASS_OR_FALLBACK', 'PASS'].includes(report.core?.bitvoice));
ok('workspace release has no blocking rows', Array.isArray(report.blocking) && report.blocking.length === 0, (report.blocking || []).join(' | '));
ok('workspace release Markdown states ok true', /ok: true/.test(md));

for (const row of report.artifacts || []) {
  const exists = existsSync(row.path);
  ok(`artifact presence matches: ${row.name}`, exists === row.present, `${row.present} vs ${exists}`);
  if (exists) ok(`artifact hash matches: ${row.name}`, sha(row.path) === row.sha256, `${row.sha256} vs ${sha(row.path)}`);
  ok(`artifact status valid: ${row.name}`, ['PASS', 'PENDING', 'UNAVAILABLE', 'BLOCKING'].includes(row.status), row.status);
  ok(`artifact nextAction present: ${row.name}`, typeof row.nextAction === 'string' && row.nextAction.length > 0);
  if (row.status === 'BLOCKING') ok(`blocking row explained: ${row.name}`, Array.isArray(row.redGates) && row.redGates.length > 0);
}
ok('wscheppity vendor READY is PENDING or PASS', ['PENDING', 'PASS'].includes((report.artifacts || []).find((a) => a.name === 'wscheppity-vendor-ready')?.status));
ok('PENDING rows are not blocking', (report.artifacts || []).filter((a) => a.status === 'PENDING').every((a) => a.blocking === false));
ok('UNAVAILABLE rows are not blocking', (report.artifacts || []).filter((a) => a.status === 'UNAVAILABLE').every((a) => a.blocking === false));

const expectedFingerprint = createHash('sha256').update(JSON.stringify({
  gmInstaller: sha(GM_INSTALLER),
  rows: (report.artifacts || []).map((a) => [a.path, existsSync(a.path), sha(a.path)]),
})).digest('hex');
ok('source fingerprint matches live peer hashes', report.sourceFingerprint === expectedFingerprint, `${report.sourceFingerprint} vs ${expectedFingerprint}`);
ok('gm installer hash matches report', report.gm?.installerSha256 === sha(GM_INSTALLER));
ok('gmweb release readiness still ok', readJson(join(ROOT, 'docs/RELEASE_READINESS.json'))?.ok === true);
ok('rollout report still schema 4 or higher', (readJson(join(ROOT, 'docs/ROLLOUT_REPORT.json'))?.schema || 0) >= 4);

const token = run(process.execPath, ['startup/check-hidden-tokens.mjs']);
ok('hidden-token scan clean', Number(token.status) === 0);
const survivor = run(process.execPath, ['startup/check-survivors.mjs']);
ok('no survivor processes', Number(survivor.status) === 0);
const grep = run('grep', ['-RInE', 'agentgui@1\\.0\\.1126|agentgui@latest|bunx.*agentgui@|npx -y agentgui', 'startup', 'docker', 'Dockerfile', 'Dockerfile.headless', '--exclude=check-*.mjs', '--exclude=validate-*.mjs', '--exclude=rollout-report.mjs', '--exclude=live-post-restart-probe.mjs', '--exclude=gm-install.log']);
ok('active forbidden grep has no matches', Number(grep.status) === 1, `exit=${grep.status}`);
const drift = run(process.execPath, ['scripts/check-gm-upstream-drift.mjs']);
ok('gm installer drift remains clean', Number(drift.status) === 0 && /GM_DRIFT_OK/.test(drift.stdout || ''));

for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} workspace-release validation checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('WORKSPACE_RELEASE_VALID ok=true path=docs/WORKSPACE_RELEASE.json');
