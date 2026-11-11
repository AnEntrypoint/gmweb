#!/usr/bin/env node
// Deterministic gate for live-post-restart-probe.mjs fixture outcomes.
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'startup/fixtures/post-restart');
const PROBE = join(ROOT, 'startup/live-post-restart-probe.mjs');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function run(args) { return spawnSync(process.execPath, [PROBE, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 8000 }); }
const selftest = run([]);
ok('probe SELFTEST exits 0', Number(selftest.status) === 0);
ok('probe SELFTEST reports SELFTEST', /STATUS=SELFTEST/.test(selftest.stdout || ''));
ok('probe SELFTEST reports 4/4', /PROBE_CHECKS 4\/4/.test(selftest.stdout || ''));

const cases = [
  ['healthy', 'PASS', 'github:AnEntrypoint/agentgui#main'],
  ['stale-npm-pin', 'FAIL', ['agentgui', '1.0.1126'].join('@')],
  ['unreachable', 'UNAVAILABLE', null],
];
for (const [name, expected, marker] of cases) {
  const dir = join(FIXTURES, name);
  ok(`fixture directory exists: ${name}`, existsSync(dir));
  const r = run(['--fixture', name, '--expect', expected]);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  ok(`fixture ${name} expected ${expected}`, Number(r.status) === 0 && out.includes(`STATUS=${expected} EXPECTED=${expected}`), `exit=${r.status}`);
  if (marker) {
    const log = join(dir, 'gm-install.log');
    ok(`fixture ${name} marker present`, existsSync(log) && readFileSync(log, 'utf8').includes(marker));
  }
}
ok('healthy fixture has HTTP status 200', /^200/.test(readFileSync(join(FIXTURES, 'healthy/status.txt'), 'utf8')));
ok('unreachable fixture has no status endpoint', !existsSync(join(FIXTURES, 'unreachable/status.txt')));
ok('probe timeout is bounded to <=2s by source', readFileSync(PROBE, 'utf8').includes('Math.min(2000'));
ok('probe uses GET/HEAD only in URL mode', /curl', \['-fsS'/.test(readFileSync(PROBE, 'utf8')) && /curl', \['-fsSI'/.test(readFileSync(PROBE, 'utf8')));
ok('probe performs no writes/restarts/installs/registration', !/writeFileSync|mkdirSync|docker compose restart|npm install|gm install(?! registration)/.test(readFileSync(PROBE, 'utf8')));

for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} live-probe fixture checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
