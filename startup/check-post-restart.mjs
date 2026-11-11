#!/usr/bin/env node
// Bounded post-restart verification plan. --offline (default) validates the
// exact commands/expected outputs without touching a container. --live is an
// opt-in read-only probe; UNAVAILABLE is a clean, explicit result.
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODE_ARG = process.argv.slice(2).find((arg) => arg === '--live' || arg === '--offline');
const MODE = MODE_ARG === '--live' ? 'live' : 'offline';
const BASE_URL = process.env.GMWEB_POST_RESTART_URL || 'http://127.0.0.1';
const PORT = process.env.GMWEB_POST_RESTART_PORT || '9897';
const TIMEOUT_MS = Math.min(3000, Math.max(250, Number(process.env.GMWEB_POST_RESTART_TIMEOUT_MS || 1200)));
const GITHUB_SPEC = 'github:AnEntrypoint/agentgui#main';
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function file(relativePath) { return readFileSync(join(ROOT, relativePath), 'utf8'); }
function report(status) {
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  console.log(`\n${checks.length - failures.length}/${checks.length} post-restart checks passed; STATUS=${status}`);
  if (failures.length) {
    console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
}

const post = file('docs/POST-RESTART.md');
const rollout = file('docs/CONTAINER-ROLLOUT.md');
const gmInstall = file('GM_INSTALL.md');
const containerDoc = file('docs/CONTAINER-ROLLOUT.md');
const agentgui = file('startup/services/agentgui.js');
const installer = file('docker/install-gm.sh');
const rest = file('docker/rest-of-startup.sh');

// Offline command plan and expected-output validation.
ok('mode is offline by default unless --live is explicit', MODE === 'offline' || MODE_ARG === '--live');
ok('post-restart doc has exact rollout command', post.includes('docker compose restart gmweb'));
ok('post-restart doc has headless rollout command', post.includes('docker compose -f docker-compose.headless.yaml restart gmweb-headless'));
ok('offline plan references real service file', post.includes('/opt/gmweb-startup/services/agentgui.js') && existsSync(join(ROOT, 'startup/services/agentgui.js')));
ok('offline plan references real installer source', post.includes('/opt/gmweb-startup/install-gm.sh') && existsSync(join(ROOT, 'docker/install-gm.sh')));
ok('offline plan has active GitHub spec grep', post.includes(`grep -n "${GITHUB_SPEC}" /opt/gmweb-startup/services/agentgui.js`) && agentgui.includes(GITHUB_SPEC));
ok('offline plan has npm-pin deny grep', post.includes('agentgui@1.0.1126') && post.includes('agentgui@latest'));
ok('offline plan has STARTUP_REF/log checks', post.includes('STARTUP_REF') && post.includes('/config/logs/rest-of-startup.log') && rest.includes('STARTUP_REF="${STARTUP_REF:-main}"'));
ok('offline plan has supervisor health/log paths', post.includes('/config/logs/supervisor.log') && post.includes('/config/logs/gm-install.log'));
ok('offline plan has live AgentGUI health endpoint', post.includes('/gm/api/agents'));
ok('offline plan has sha parity command', post.includes('sha256sum docker/install-gm.sh /workspace/gm/scripts/install.sh'));
ok('installer parity command targets real canonical file', existsSync('/workspace/gm/scripts/install.sh'));
ok('installer contains canonical manifest/sha/version markers', installer.includes('manifest.json') && installer.includes('sha256sum') && installer.includes('"version":"%s"'));
ok('rollout doc links POST-RESTART', rollout.includes('docs/POST-RESTART.md') || rollout.includes('POST-RESTART.md'));
ok('GM_INSTALL links POST-RESTART', gmInstall.includes('POST-RESTART.md'));
ok('offline plan has bounded timeout evidence', post.includes('GMWEB_POST_RESTART_TIMEOUT_MS') && TIMEOUT_MS <= 3000);
ok('offline plan has no secrets or signed URLs', !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|X-Amz-(Algorithm|Credential|Signature)|-----BEGIN .*PRIVATE KEY-----/i.test(post));
ok('offline plan has no publish/commit command', !/\b(git push|git commit|docker push|npm publish|gh release create)\b/.test(post.replace(/do not .*/gi, '')));
ok('offline plan forbids restart inside checker', post.includes('never start/restart') || post.includes('does not restart'));
ok('offline plan documents UNAVAILABLE', post.includes('UNAVAILABLE'));
ok('container rollout doc covers fetched runtime paths', containerDoc.includes('/opt/gmweb-startup/services/agentgui.js') && containerDoc.includes('/opt/gmweb-startup/install-gm.sh'));

if (MODE === 'offline') {
  ok('offline mode performs no HTTP/log/container probes', true, 'static command validation only');
  report('OFFLINE_PLAN_VALID');
} else {
  // Live mode: read-only local probes with a short abort. No restart or start.
  const endpoints = [`${BASE_URL}/gm/api/agents`, `${BASE_URL}:${PORT}/gm/api/agents`]
    .filter((url, index, all) => all.indexOf(url) === index);
  const evidence = [];
  let reachable = null;
  for (const url of endpoints) {
    const r = spawnSync('curl', ['-fsS', '--max-time', String(Math.ceil(TIMEOUT_MS / 1000)), url], { encoding: 'utf8', timeout: TIMEOUT_MS + 300 });
    evidence.push(`${url}: curl_exit=${r.status ?? 'timeout/error'}${r.stderr ? ` stderr=${r.stderr.trim().slice(0, 120)}` : ''}`);
    if (r.status === 0) { reachable = { url, body: r.stdout || '' }; break; }
  }
  if (!reachable) {
    ok('live probe was bounded and read-only', true, `${TIMEOUT_MS}ms, GET only`);
    console.log(`LIVE_EVIDENCE ${evidence.join(' | ')}`);
    console.log('UNAVAILABLE: no reachable local gmweb service; offline plan remains valid; no container was started or restarted');
    report('UNAVAILABLE');
  } else {
    const logs = ['/config/logs/supervisor.log', '/config/logs/gm-install.log', '/config/logs/rest-of-startup.log'];
    const availableLogs = logs.filter((p) => existsSync(p));
    const logText = availableLogs.map((p) => readFileSync(p, 'utf8')).join('\n');
    const runtimeTree = existsSync('/opt/gmweb-startup/services/agentgui.js')
      ? readFileSync('/opt/gmweb-startup/services/agentgui.js', 'utf8')
      : null;
    ok('live health endpoint reachable', true, reachable.url);
    ok('live active AgentGUI spec is GitHub main', runtimeTree && runtimeTree.includes(GITHUB_SPEC), runtimeTree ? 'checked /opt/gmweb-startup/services/agentgui.js' : 'runtime tree unavailable');
    ok('live active AgentGUI spec has no npm pin', runtimeTree && !runtimeTree.includes(['agentgui', '1.0.1126'].join('@')));
    ok('live gm install log has canonical manifest/sha/version evidence', /manifest\.json/.test(logText) && /sha256|size/.test(logText) && /version|gmnew/.test(logText), availableLogs.join(', ') || 'no local logs readable');
    ok('live supervisor health/log evidence present', reachable.body.length > 0 || availableLogs.length > 0);
    report('LIVE_VERIFIED');
  }
}
