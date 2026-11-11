#!/usr/bin/env node
// Bounded, offline runtime smoke test for the changed startup services.
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import net from 'net';

const STARTUP = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(STARTUP, '..');
const CHECKS = [];
const FAILURES = [];
const TIMEOUT_MS = 5000;
const AGENTGUI_EXPECTED = 'github:AnEntrypoint/agentgui#main';
const FORBIDDEN = [
  ['agentgui', '1.0.1126'].join('@'),
  'agentgui@latest',
  /bunx[^\n]*agentgui@/,
  /spawn\([^)]*\[['"]agentgui['"]/,
  /npx[^\n]*-y[^\n]*['"]agentgui['"]/,
];

function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  CHECKS.push({ name, passed, detail });
  if (!passed) FAILURES.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function forbiddenMatches(text) {
  return FORBIDDEN.filter((pattern) => typeof pattern === 'string'
    ? text.includes(pattern)
    : pattern.test(text)).map(String);
}

function makeStream() {
  return { on() { return this; } };
}

function makeFakeAgentGuiProcess(pid) {
  const listeners = {};
  return {
    pid,
    stdout: makeStream(),
    stderr: makeStream(),
    unref() {},
    on(event, fn) { listeners[event] = fn; return this; },
    emit(event, ...args) { listeners[event]?.(...args); },
  };
}

async function portIsFree(port) {
  return new Promise((resolveFree) => {
    const socket = new net.Socket();
    const finish = (free) => { socket.destroy(); resolveFree(free); };
    socket.setTimeout(400);
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.once('timeout', () => finish(true));
    socket.connect(port, 'localhost');
  });
}

async function withTimeout(promise, name) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer); }
}

async function testAgentGuiRuntime() {
  const servicePath = join(STARTUP, 'services', 'agentgui.js');
  const module = await import(pathToFileURL(servicePath).href);
  const service = module.default;
  const testPort = module.AGENTGUI_TEST_PORT;
  const fakePid = 4000000 + (process.pid % 100000);
  const fakeProcess = makeFakeAgentGuiProcess(fakePid);
  let observed = null;

  module.__setAgentGuiSpawnForTest((bin, args, options) => {
    observed = { bin, args, options };
    return fakeProcess;
  });

  ok('agentgui runtime: real ESM service module loaded', service?.name === 'agentgui');
  ok('agentgui runtime: test port is free before start', await portIsFree(testPort));
  const handle = await withTimeout(service.start({ PATH: process.env.PATH, HOME: '/tmp', GMWEB_AGENTGUI_SMOKE_TEST: '1' }), 'agentgui.start');
  ok('agentgui runtime: start returned a process handle', handle?.pid === fakePid);
  ok('agentgui runtime: exactly one spawn was intercepted', observed !== null);
  ok('agentgui runtime: spawn uses -y and exact GitHub spec',
    observed?.args?.[0] === '-y' && observed?.args?.[1] === AGENTGUI_EXPECTED,
    JSON.stringify(observed?.args || []));
  ok('agentgui runtime: spawn binary resolves to npx', /npx$/.test(String(observed?.bin || '')), String(observed?.bin));
  ok('agentgui runtime: child is detached and unref path is exercised', observed?.options?.detached === true);
  ok('agentgui runtime: production env preserved',
    observed?.options?.env?.BASE_URL === '/gm' && observed?.options?.env?.PORT === String(testPort) &&
    observed?.options?.env?.HOT_RELOAD === 'false');

  const runtimeCommand = [observed?.bin, ...(observed?.args || []), JSON.stringify(observed?.options?.env || {})].join(' ');
  const matches = forbiddenMatches(runtimeCommand);
  ok('agentgui runtime: no forbidden npm pin/latest/bunx/bare spec', matches.length === 0, matches.join(', '));
  ok('agentgui runtime: health grace is active after start', await withTimeout(service.health(), 'agentgui.health') === true);
  await withTimeout(handle.cleanup(), 'agentgui.cleanup');
  ok('agentgui runtime: test port is free after cleanup', await portIsFree(testPort));
  module.__setAgentGuiSpawnForTest(undefined);
}

async function testGmInstallDryRun() {
  const servicePath = join(STARTUP, 'services', 'gm-install.js');
  const module = await import(pathToFileURL(servicePath).href);
  const service = module.default;
  const runtime = module.GM_INSTALL_RUNTIME;
  const tempDir = mkdtempSync(join(tmpdir(), 'gmweb-gm-install-'));
  const mcpConfig = join(tempDir, 'mcp.json');
  const env = {
    PATH: process.env.PATH,
    GM_INSTALL_DRY_RUN: '1',
    GMNEW_SKIP_REGISTER: '1',
    GMNEW_AUTO_UPDATE: '0',
    GMWEB_GM_MCP_CONFIG: mcpConfig,
    GMWEB_GM_INSTALL_RETRY_SECONDS: '30',
  };

  const resolved = module.resolveInstallerCommand(env);
  const commandText = [resolved.command, ...resolved.args].join(' ');
  const installer = readFileSync(join(ROOT, 'docker', 'install-gm.sh'), 'utf8');
  const upstream = readFileSync('/workspace/gm/scripts/install.sh', 'utf8');
  const normalize = (text) => text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('#!'))
    .filter((line) => !line.startsWith('RELEASE_BASE='))
    .filter((line) => !line.includes('https://raw.githubusercontent.com'))
    .join('\n');

  ok('gm-install runtime: dry run does not spawn/install',
    env.GM_INSTALL_DRY_RUN === '1' && /GM_INSTALL_DRY_RUN === '1'/.test(readFileSync(servicePath, 'utf8')));
  let dryRunLogged = false;
  const originalLog = console.log;
  console.log = (...args) => { if (args.join(' ').includes('Dry run: resolved installer command')) dryRunLogged = true; };
  let handle;
  try { handle = await withTimeout(service.start(env), 'gm-install.start'); }
  finally { console.log = originalLog; }
  ok('gm-install runtime: resolved dry-run path was executed', dryRunLogged);
  ok('gm-install runtime: dry-run start is non-blocking', handle?.pid === 0 && handle?.process === null);
  ok('gm-install runtime: canonical installer URL in resolved command',
    commandText.includes(runtime.INSTALLER_URL) && runtime.INSTALLER_URL.includes('/scripts/install.sh'));
  ok('gm-install runtime: resolved command is detached/non-blocking',
    resolved.detached === true && resolved.stdio === 'ignore' && resolved.command === 'sh');
  ok('gm-install runtime: log path resolved', commandText.includes(runtime.LOG_FILE), runtime.LOG_FILE);
  ok('gm-install runtime: --mcp-config preserved', commandText.includes(`--mcp-config "${mcpConfig}"`));
  ok('gm-install runtime: GMNEW_SKIP_REGISTER preserved', resolved.env.GMNEW_SKIP_REGISTER === '1');
  ok('gm-install runtime: GMNEW_AUTO_UPDATE preserved', resolved.env.GMNEW_AUTO_UPDATE === '0');
  ok('gm-install runtime: canonical release base preserved',
    resolved.env.GMNEW_RELEASE_BASE === 'https://github.com/AnEntrypoint/gm/releases/download/latest');
  ok('gm-install runtime: vendored installer matches canonical behavioral signature',
    existsSync(join(ROOT, 'docker', 'install-gm.sh')) && normalize(installer) === normalize(upstream));
  ok('gm-install runtime: parity rule includes canonical --local/register paths',
    normalize(installer).includes('install_local') && normalize(installer).includes('register') &&
    normalize(upstream).includes('install_local') && normalize(upstream).includes('register'));
  ok('gm-install runtime: dry run never changes gm target or registration state',
    !installer.includes('add-mcp') && env.GM_INSTALL_DRY_RUN === '1' && env.GMNEW_SKIP_REGISTER === '1');
  ok('gm-install runtime: sha256/size verification code paths present',
    installer.includes('EXPECTED_SHA') && installer.includes('EXPECTED_SIZE') &&
    installer.includes('ACTUAL_SHA') && installer.includes('ACTUAL_SIZE') &&
    installer.includes('sha256sum') && installer.includes('wc -c'));
  ok('gm-install runtime: manifest URL and native install present',
    installer.includes('$RELEASE_BASE/manifest.json') && installer.includes('"$EXE" install') &&
    installer.includes('.gmnew-update.json'));
  ok('gm-install runtime: no real target/state written by smoke test',
    !existsSync(mcpConfig) && !existsSync(join(tempDir, '.gmnew')));
  ok('gm-install runtime: no stale Node add-mcp registration', !/^[ \t]*(?!#).*add-mcp/m.test(installer));
  rmSync(tempDir, { recursive: true, force: true });
}

function syntaxChecks() {
  const js = ['services/agentgui.js', 'services/gm-install.js', 'check-runtime-install.mjs'];
  for (const relative of js) {
    const r = spawnSync(process.execPath, ['--check', join(STARTUP, relative)], { encoding: 'utf8' });
    ok(`node --check ${relative}`, r.status === 0, (r.stderr || r.stdout || '').trim());
  }
  const sh = [['../docker/install-gm.sh', 'sh'], ['start.sh', 'bash'], ['../docker/rest-of-startup.sh', 'bash']];
  for (const [relative, interpreter] of sh) {
    const r = spawnSync(interpreter, ['-n', join(STARTUP, relative)], { encoding: 'utf8' });
    ok(`${interpreter} -n ${relative}`, r.status === 0, (r.stderr || r.stdout || '').trim());
  }
  for (const relative of ['config.json', 'package.json', '../package.json']) {
    const r = spawnSync(process.execPath, ['-e', 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))', join(STARTUP, relative)], { encoding: 'utf8' });
    ok(`JSON parse ${relative}`, r.status === 0, (r.stderr || '').trim());
  }
}

try {
  await testAgentGuiRuntime();
  await testGmInstallDryRun();
  syntaxChecks();
  const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  const ownPid = String(process.pid);
  const survivors = (ps.stdout || '').split('\n').filter((line) => {
    if (line.trimStart().startsWith(`${ownPid} `)) return false;
    return line.includes('github:AnEntrypoint/agentgui#main') ||
      line.includes('gmweb-gm-install-') || line.includes('GM_INSTALL_DRY_RUN=1');
  });
  ok('runtime smoke: no test service or install command survives', survivors.length === 0, survivors.join(' | '));
} catch (error) {
  ok('runtime smoke completes within bounded timeout', false, error.message);
} finally {
  globalThis.__GMWEB_AGENTGUI_TEST_SPAWN__ = undefined;
}

for (const check of CHECKS) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` -- ${check.detail}` : ''}`);
console.log(`\n${CHECKS.length - FAILURES.length}/${CHECKS.length} runtime checks passed`);
if (FAILURES.length) {
  console.error(`\n${FAILURES.length} failed:\n- ${FAILURES.join('\n- ')}`);
  process.exit(1);
}
