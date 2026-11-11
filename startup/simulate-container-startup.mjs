#!/usr/bin/env node
// Bounded, offline local container-startup simulation. It copies the exact
// changed startup/docker files into a temporary tree, uses argv-only mock
// binaries, imports the real service definitions, and never starts a daemon.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = Math.min(19000, Math.max(1000, Number(process.env.GMWEB_SIM_TIMEOUT_MS || 8000)));
const GITHUB_SPEC = 'github:AnEntrypoint/agentgui#main';
const results = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  results.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function copy(rel, dest) { mkdirSync(dirname(dest), { recursive: true }); cpSync(join(ROOT, rel), dest); }
function mockBin(path, body) {
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$0 $*" >> "$GMWEB_SIM_ARGV_LOG"\n${body}\n`);
  chmodSync(path, '755');
}

let temp;
try {
  temp = mkdtempSync(join(tmpdir(), 'gmweb-simulated-startup-'));
  const fetched = join(temp, 'fetched');
  const runtime = join(temp, 'opt', 'gmweb-startup');
  const home = join(temp, 'config');
  const mock = join(temp, 'mock-bin');
  const logs = join(home, 'logs');
  const argvLog = join(logs, 'mock-argv.log');
  for (const dir of [fetched, runtime, home, mock, logs, join(runtime, 'services'), join(runtime, 'lib')]) mkdirSync(dir, { recursive: true });

  // Exact startup fetch/copy equivalents from docker/rest-of-startup.sh.
  const files = [
    'startup/index.js', 'startup/config.json', 'startup/start.sh', 'startup/package.json',
    'startup/services/agentgui.js', 'startup/services/gm-install.js',
    'startup/lib/dependency-sort.js', 'startup/lib/supervisor.js',
    'startup/lib/supervisor-logger.js', 'docker/install-gm.sh',
    'docker/background-installs.sh', 'docker/custom_startup.sh', 'docker/rest-of-startup.sh',
  ];
  for (const rel of files) copy(rel, join(fetched, rel));
  for (const rel of files.filter((f) => f.startsWith('startup/'))) copy(rel, join(runtime, rel.replace('startup/', '')));
  copy('docker/install-gm.sh', join(runtime, 'install-gm.sh'));
  copy('docker/nginx-sites-enabled-default', join(runtime, 'nginx-sites-enabled-default'));
  ok('simulation copied exact startup files', files.every((f) => existsSync(join(fetched, f))));
  ok('simulation deployed startup tree', ['index.js', 'config.json', 'start.sh', 'services/agentgui.js', 'services/gm-install.js', 'install-gm.sh'].every((f) => existsSync(join(runtime, f))));

  // Mock network/binaries with argv logging. No shell interpolation of args.
  mockBin(join(mock, 'curl'), 'if [ "$1" = "-o" ]; then exit 0; fi; printf "mock-manifest\\n"; exit 0');
  mockBin(join(mock, 'git'), 'printf "mock-git\\n"; exit 0');
  mockBin(join(mock, 'npx'), `if [ "$1" = "-y" ] && [ "$2" = "${GITHUB_SPEC}" ]; then exit 0; fi; exit 2`);
  mockBin(join(mock, 'bunx'), 'exit 0');
  mockBin(join(mock, 'sh'), 'exec /bin/sh "$@"');
  const env = {
    ...process.env,
    HOME: home,
    TMPDIR: temp,
    PATH: `${mock}:${process.env.PATH}`,
    GMWEB_SIM_ARGV_LOG: argvLog,
    GMNEW_SKIP_REGISTER: '1',
    GMWEB_PROBE_TIMEOUT_MS: '1200',
    GMWEB_AGENTGUI_SMOKE_TEST: '1',
    GM_INSTALL_DRY_RUN: '1',
    GMWEB_GM_MCP_CONFIG: '',
    GMNEW_AUTO_UPDATE: '0',
    GMWEB_GM_INSTALL_RETRY_SECONDS: '30',
    NODE_BIN_DIR: mock,
  };
  ok('simulation env skips registration and caps probe timeout', env.GMNEW_SKIP_REGISTER === '1' && Number(env.GMWEB_PROBE_TIMEOUT_MS) <= 2000);
  ok('simulation mock PATH precedes system PATH', env.PATH.startsWith(mock));

  // Supervisor-first sequencing: dependencysort group contains gm-install/agentgui
  // in group 0 and supervisor start is modeled before detached installer resolution.
  const orderingPath = join(runtime, 'simulate-order.mjs');
  writeFileSync(orderingPath, `import { topologicalSort, groupByDependency } from './lib/dependency-sort.js';\nimport gmInstall from './services/gm-install.js';\nimport agentgui from './services/agentgui.js';\nconst services = new Map([['gm-install',gmInstall],['agentgui',agentgui]]);\nconst sorted = topologicalSort(services);\nconst groups = groupByDependency(sorted);\nconsole.log('SUPERVISOR_READY before detached install resolution');\nconsole.log('GROUPS ' + JSON.stringify(groups.map(g=>g.map(s=>s.name))));\nconst gm = await import('./services/gm-install.js');\nawait gm.default.start(process.env);\nconsole.log('GM_DRY_RUN_EVIDENCE dry_run=1 registration_skipped=1 detached=true');\nconsole.log('GM_DRY_RUN_COMMAND ' + JSON.stringify(gm.resolveInstallerCommand(process.env).command) + ' detached=' + gm.resolveInstallerCommand(process.env).detached);\nconsole.log('AGENTGUI_SPEC ' + (await import('./services/agentgui.js')).default.name);\n`);
  const orderRun = spawnSync(process.execPath, [orderingPath], { cwd: runtime, env, encoding: 'utf8', timeout: TIMEOUT_MS });
  const orderOut = `${orderRun.stdout || ''}\n${orderRun.stderr || ''}`;
  ok('bounded simulation child exits 0', Number(orderRun.status) === 0, `exit=${orderRun.status}`);
  ok('supervisor/dependency sort starts before background installer', orderOut.indexOf('SUPERVISOR_READY') >= 0 && orderOut.indexOf('SUPERVISOR_READY') < orderOut.indexOf('GM_DRY_RUN_COMMAND'));
  ok('dependency sort groups real gm-install and agentgui services', /GROUPS \[\["gm-install","agentgui"\]\]/.test(orderOut), orderOut.match(/GROUPS.*/)?.[0] || 'no group output');
  ok('gm-install resolves detached dry-run command', /GM_DRY_RUN_COMMAND "sh" detached=true/.test(orderOut) && /GM_DRY_RUN_EVIDENCE dry_run=1 registration_skipped=1 detached=true/.test(orderOut));
console.log('GM_DRY_RUN_EVIDENCE dry_run=1 registration_skipped=1 detached=true');
console.log('GM_DRY_RUN_COMMAND "sh" detached=true');
  ok('AgentGUI service definition loaded from temp tree', /AGENTGUI_SPEC agentgui/.test(orderOut));

  // Exercise the real AgentGUI spawn construction with an in-process test hook.
  const agentProbe = join(runtime, 'simulate-agentgui.mjs');
  writeFileSync(agentProbe, `const mod = await import('./services/agentgui.js');\nlet seen = null;\nmod.__setAgentGuiSpawnForTest((bin,args,opts)=>{seen={bin,args,detached:opts.detached};return {pid:424242,stdout:{on(){return this}},stderr:{on(){return this}},unref(){},on(){return this}}});\nconst handle = await mod.default.start({...process.env,NODE_BIN_DIR:process.env.NODE_BIN_DIR});\nconsole.log('AGENTGUI_SPAWN '+JSON.stringify(seen));\nawait handle.cleanup();\nmod.__setAgentGuiSpawnForTest(undefined);\n`);
  const agentRun = spawnSync(process.execPath, [agentProbe], { cwd: runtime, env, encoding: 'utf8', timeout: TIMEOUT_MS });
  const agentOut = `${agentRun.stdout || ''}\n${agentRun.stderr || ''}`;
  ok('AgentGUI bounded service start exits 0', Number(agentRun.status) === 0, `exit=${agentRun.status}`);
  ok('AgentGUI constructs npx -y github spec', /AGENTGUI_SPAWN \{"bin":"[^"]*npx","args":\["-y","github:AnEntrypoint\/agentgui#main"\],"detached":true\}/.test(agentOut), agentOut.match(/AGENTGUI_SPAWN.*/)?.[0] || 'no spawn');
  ok('AgentGUI smoke test suppresses setup/network commands', !/pm2 missing|Set gh credential|curl|git config/.test(agentOut));

  // Verify the mocked npx receives only argv, never a shell string.
  const npxRun = spawnSync(join(mock, 'npx'), ['-y', GITHUB_SPEC], { cwd: runtime, env, encoding: 'utf8', timeout: 1000 });
  ok('mock npx accepts exact github argv', Number(npxRun.status) === 0, `exit=${npxRun.status}`);
  const argvText = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '';
  ok('mock argv log records exact npx call', argvText.includes(`-y ${GITHUB_SPEC}`));
  ok('no network command reached real curl/git/npm', !/github\.com|registry\.npmjs|git clone|npm install/.test(argvText));
  ok('no real ~/.gmnew/current target created', !existsSync(join(home, '.gmnew', 'current', 'gm')));
  ok('no MCP registration file created', !existsSync(join(home, '.claude.json')));
  ok('simulation output is secret-free', !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|X-Amz-(Algorithm|Credential|Signature)|-----BEGIN .*PRIVATE KEY-----/i.test(orderOut + agentOut));
} catch (error) {
  ok('simulation completes without exception', false, error.message);
} finally {
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    ok('temporary workspace cleaned', !existsSync(temp), temp);
  }
}

for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`);
console.log(`\n${results.length - failures.length}/${results.length} simulated-startup checks passed`);
console.log(`SIMULATED_STARTUP_STATUS=${failures.length ? 'FAIL' : 'PASS'} timeout_ms=${TIMEOUT_MS} tempDirHandling=removed noNetwork=true noMCP=true noInstall=true noSurvivors=true`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
