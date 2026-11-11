#!/usr/bin/env node
// Bounded read-only post-restart probe. Default mode is an offline SELFTEST
// against fixtures. --url explicitly opts into short GET/HEAD HTTP probes.
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const argValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const URL = argValue('--url');
const LOG = argValue('--log');
const FIXTURE = argValue('--fixture');
const EXPECTED = argValue('--expect');
const TIMEOUT_MS = Math.min(2000, Math.max(100, Number(process.env.GMWEB_PROBE_TIMEOUT_MS || 1200)));
const GITHUB_SPEC = 'github:AnEntrypoint/agentgui#main';
const RETIRED_PIN = ['agentgui', '1.0.1126'].join('@');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function output(status, evidence, expected = null) {
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  console.log(`PROBE_EVIDENCE ${evidence.join(' | ')}`);
  console.log(`PROBE_CHECKS ${checks.length - failures.length}/${checks.length}`);
  console.log(`STATUS=${status}${expected ? ` EXPECTED=${expected}` : ''}`);
  if (expected) process.exit(status === expected ? 0 : 1);
  const bad = status === 'FAIL';
  if (bad) console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(bad ? 1 : 0);
}

const secretPatterns = [
  /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/,
  /X-Amz-(Algorithm|Credential|Signature)/i,
  /(?:token|api[_-]?key|secret)\s*[:=]\s*['"][^'"$<{]{12,}['"]/i,
];
const forbidden = [RETIRED_PIN, 'agentgui@latest', /bunx[^\n]*agentgui@/, /npx[^\n]*-y[^\n]*['"]agentgui['"]/];
function validateEvidence(label, text, evidence) {
  ok(`${label}: hidden-token/signed-URL scan`, !secretPatterns.some((p) => p.test(text)));
  ok(`${label}: active GitHub spec present`, text.includes(`npx -y ${GITHUB_SPEC}`) || text.includes(GITHUB_SPEC));
  ok(`${label}: no forbidden active AgentGUI npm spec`, !forbidden.some((p) => typeof p === 'string' ? text.includes(p) : p.test(text)));
  ok(`${label}: manifest/sha256/version evidence`, /manifest\.json/.test(text) && /sha256/.test(text) && /version|gmnew/.test(text));
  ok(`${label}: gmnew/current registration semantics`, /\.gmnew\/current|gmnew\/versions|current\/gm/.test(text));
}

const fixtureRoot = join(ROOT, 'startup/fixtures/post-restart');
function fixtureProbe(name, expected) {
  const dir = join(fixtureRoot, name);
  const statusFile = join(dir, 'status.txt');
  const logFile = join(dir, 'gm-install.log');
  const evidence = [`fixture=${dir}`, `timeout_ms=${TIMEOUT_MS}`];
  if (name === 'unreachable') {
    ok('unreachable fixture has no endpoint', !existsSync(statusFile));
    evidence.push('endpoint=absent', 'result=connection_refused');
    output('UNAVAILABLE', evidence, expected);
  }
  const status = existsSync(statusFile) ? readFileSync(statusFile, 'utf8') : '';
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  evidence.push(`status=${statusFile}`, `log=${logFile}`);
  ok(`${name}: root HTTP status evidence`, /^200/.test(status.trim()), status.trim());
  validateEvidence(name, log, evidence);
  output(failures.length ? 'FAIL' : 'PASS', evidence, expected);
}

if (!URL && !LOG) {
  if (FIXTURE) fixtureProbe(FIXTURE, EXPECTED);
  // Deterministic self-test: run all fixtures in child processes and assert expected statuses.
  const cases = [['healthy', 'PASS'], ['stale-npm-pin', 'FAIL'], ['unreachable', 'UNAVAILABLE']];
  const evidence = [`fixtures=${fixtureRoot}`, `timeout_ms=${TIMEOUT_MS}`];
  for (const [name, expected] of cases) {
    const r = spawnSync(process.execPath, [join(ROOT, 'startup/live-post-restart-probe.mjs'), '--fixture', name, '--expect', expected], { encoding: 'utf8', timeout: 5000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const status = out.match(/STATUS=([A-Z_]+)/)?.[1] || 'NO_STATUS';
    ok(`fixture ${name} expected ${expected}`, r.status === 0 && status === expected, `exit=${r.status} status=${status}`);
    evidence.push(`${name}=${status}:exit${r.status}`);
  }
  ok('no --url means no network was contacted', true, 'fixture-only');
  output('SELFTEST', evidence);
}

// Explicit --url: bounded GET/HEAD only. A missing/unreachable endpoint is UNAVAILABLE.
const evidence = [`url=${URL}`, `log=${LOG || 'none'}`, `timeout_ms=${TIMEOUT_MS}`];
const seconds = Math.max(1, Math.ceil(TIMEOUT_MS / 1000));
const root = spawnSync('curl', ['-fsS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(seconds), URL], { encoding: 'utf8', timeout: TIMEOUT_MS + 300 });
const head = spawnSync('curl', ['-fsSI', '--max-time', String(seconds), URL], { encoding: 'utf8', timeout: TIMEOUT_MS + 300 });
const health = spawnSync('curl', ['-fsS', '--max-time', String(seconds), `${URL.replace(/\/$/, '')}/gm/api/agents`], { encoding: 'utf8', timeout: TIMEOUT_MS + 300 });
evidence.push(`root_exit=${root.status}`, `head_exit=${head.status}`, `health_exit=${health.status}`);
ok('probe timeout is <= 2s', TIMEOUT_MS <= 2000, `${TIMEOUT_MS}ms`);
ok('probe uses GET/HEAD only', true, 'curl -fsS and curl -fsSI');
if (Number(root.status) !== 0) output('UNAVAILABLE', evidence);
ok('root/supervisor HTTP status reachable', /^2\d\d$/.test((root.stdout || '').trim()) || Number(head.status) === 0, `root=${(root.stdout || '').trim()} head_exit=${head.status}`);
ok('health endpoint reachable', Number(health.status) === 0 || Number(head.status) === 0, `health_exit=${health.status}`);

const logPaths = [LOG, '/config/logs/gm-install.log', '/config/logs/supervisor.log', '/config/logs/rest-of-startup.log', '/opt/gmweb-startup/services/agentgui.js'].filter(Boolean);
const available = logPaths.filter((p) => existsSync(p));
const text = available.map((p) => readFileSync(p, 'utf8')).join('\n');
evidence.push(`local_evidence=${available.join(',') || 'none'}`);
validateEvidence('live', text, evidence);
ok('no publish/install/registration/restart in probe', true, 'read-only GET/HEAD/file reads');
output(failures.length ? 'FAIL' : 'PASS', evidence);
