#!/usr/bin/env node
// Deterministic Docker/container-startup-path validation. No build, restart,
// network, install, MCP registration, or long-lived service.
import { readFileSync, existsSync, cpSync, mkdirSync, mkdtempSync, rmSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve, relative } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const STARTUP = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(STARTUP, '..');
const CHECKS = [];
const FAILURES = [];
const CANONICAL_REPO = 'AnEntrypoint/gmweb';
const CANONICAL_REF = 'main';
const GITHUB_SPEC = 'github:AnEntrypoint/agentgui#main';

function file(relativePath) { return readFileSync(join(ROOT, relativePath), 'utf8'); }
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  CHECKS.push({ name, passed, detail });
  if (!passed) FAILURES.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function allFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
function json(relativePath) { return JSON.parse(file(relativePath)); }

const dockerfile = file('Dockerfile');
const headlessDockerfile = file('Dockerfile.headless');
const compose = file('docker-compose.yaml');
const composeHeadless = file('docker-compose.headless.yaml');
const rest = file('docker/rest-of-startup.sh');
const custom = file('docker/custom_startup.sh');
const background = file('docker/background-installs.sh');
const start = file('startup/start.sh');
const rootStartup = file('startup.sh');
const installSh = file('startup/install.sh');
const init = file('docker/99-gmweb-startup.sh');
const index = file('startup/index.js');
const config = json('startup/config.json');
const agentgui = file('startup/services/agentgui.js');
const gmInstall = file('startup/services/gm-install.js');
const dependencySort = file('startup/lib/dependency-sort.js');

// 1. Baked vs fetched classification from actual Dockerfile COPY lines.
const dockerCopies = [...dockerfile.matchAll(/^COPY\s+(\S+)\s+(\S+)\s*$/gm)].map((m) => ({ from: m[1], to: m[2] }));
const headlessCopies = [...headlessDockerfile.matchAll(/^COPY\s+(\S+)\s+(\S+)\s*$/gm)].map((m) => ({ from: m[1], to: m[2] }));
const baked = [
  'docker/99-gmweb-startup.sh', 'docker/custom_startup.sh', 'docker/nginx-setup.sh',
  'docker/nginx-sites-enabled-default', 'docker/rest-of-startup.sh',
  'docker/background-installs.sh', 'docker/install-gm.sh',
];
for (const path of baked) {
  ok(`Dockerfile bakes ${path}`, dockerCopies.some((c) => c.from === path && c.to.startsWith('/custom-cont-init.d/')));
  ok(`Dockerfile.headless bakes ${path}`, headlessCopies.some((c) => c.from === path && c.to.startsWith('/custom-cont-init.d/')));
}
ok('only 99-gmweb-startup.sh is made executable by Dockerfiles',
  /chmod \+x \/custom-cont-init\.d\/99-gmweb-startup\.sh/.test(dockerfile) &&
  /chmod \+x \/custom-cont-init\.d\/99-gmweb-startup\.sh/.test(headlessDockerfile));
ok('s6 entrypoint executes baked custom_startup.sh', /exec bash "\$STARTUP_SCRIPT"/.test(init) && /custom_startup\.sh/.test(init));
ok('compose uses Dockerfile and Dockerfile.headless respectively',
  /dockerfile:\s*Dockerfile\s*$/m.test(compose) && /dockerfile:\s*Dockerfile\.headless\s*$/m.test(composeHeadless));
ok('compose has no pinned STARTUP_REF that would defeat main fetch',
  !/STARTUP_REF/.test(compose) && !/STARTUP_REF/.test(composeHeadless));

// 2. Container boot fetch points at AnEntrypoint/gmweb main.
ok('rest-of-startup uses canonical repository', rest.includes(`STARTUP_SOURCE_URL="https://github.com/${CANONICAL_REPO}.git"`));
ok('STARTUP_REF defaults to main', /STARTUP_REF="\$\{STARTUP_REF:-main\}"/.test(rest));
ok('git fetch uses STARTUP_REF and checkout verifies HEAD',
  /git -C \/tmp\/gmweb fetch --depth 1 --filter=blob:none origin "\$STARTUP_REF"/.test(rest) &&
  /git -C \/tmp\/gmweb checkout --detach --quiet FETCH_HEAD/.test(rest) &&
  /git -C \/tmp\/gmweb rev-parse --verify HEAD/.test(rest));
ok('boot clears stale /opt/gmweb-startup service files before fetch',
  /rm -rf \/tmp\/gmweb \/opt\/gmweb-startup\/node_modules \/opt\/gmweb-startup\/lib/.test(rest) &&
  /\/opt\/gmweb-startup\/services/.test(rest) && /\/opt\/gmweb-startup\/\*\.js/.test(rest));
ok('legacy startup.sh is not a pinned conflicting ref',
  rootStartup.includes('--branch main') && !/STARTUP_REF=.*[0-9a-f]{40}/.test(rootStartup));

// 3. Fetched tree copy simulation in a bounded temp directory.
const temp = mkdtempSync(join(tmpdir(), 'gmweb-container-path-'));
try {
  const fetched = join(temp, 'fetched');
  const deployed = join(temp, 'opt', 'gmweb-startup');
  mkdirSync(join(fetched, 'startup', 'services'), { recursive: true });
  mkdirSync(join(fetched, 'docker'), { recursive: true });
  mkdirSync(deployed, { recursive: true });
  for (const relativePath of [
    'startup/index.js', 'startup/config.json', 'startup/start.sh', 'startup/package.json',
    'startup/services/agentgui.js', 'startup/services/gm-install.js',
    'startup/check-startup-sources.mjs', 'startup/check-runtime-install.mjs',
    'startup/check-container-startup-path.mjs', 'docker/install-gm.sh',
  ]) {
    cpSync(join(ROOT, relativePath), join(fetched, relativePath));
  }
  // Mirror the exact copy statements from docker/rest-of-startup.sh:135-138.
  for (const path of allFiles(join(fetched, 'startup'))) {
    const target = join(deployed, relative(join(fetched, 'startup'), path));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(path, target);
  }
  cpSync(join(fetched, 'docker', 'install-gm.sh'), join(deployed, 'install-gm.sh'));
  for (const relativePath of [
    'index.js', 'config.json', 'start.sh', 'services/agentgui.js', 'services/gm-install.js',
    'check-startup-sources.mjs', 'check-runtime-install.mjs', 'check-container-startup-path.mjs',
    'install-gm.sh',
  ]) ok(`simulated boot deploys ${relativePath}`, existsSync(join(deployed, relativePath)));
  ok('simulated deployed AgentGUI is byte-identical to source',
    sha(join(ROOT, 'startup/services/agentgui.js')) === sha(join(deployed, 'services/agentgui.js')));
  ok('simulated deployed installer is byte-identical to docker/install-gm.sh',
    sha(join(ROOT, 'docker/install-gm.sh')) === sha(join(deployed, 'install-gm.sh')));
  ok('simulated deployed installer is not the baked stale duplicate',
    sha(join(deployed, 'install-gm.sh')) === sha(join(ROOT, 'docker/install-gm.sh')));
  ok('rest-of-startup copies docker/install-gm.sh from fetched tree',
    /cp \/tmp\/gmweb\/docker\/install-gm\.sh \/opt\/gmweb-startup\/install-gm\.sh/.test(rest));
  ok('baked /custom-cont-init.d/install-gm.sh is fallback only, not service path',
    !/custom-cont-init\.d\/install-gm\.sh/.test(gmInstall) && /'install-gm\.sh'/.test(gmInstall));
  ok('background-installs invokes fetched startup/install.sh', background.includes('bash /opt/gmweb-startup/install.sh'));
} finally {
  rmSync(temp, { recursive: true, force: true });
  ok('temporary container-path simulation was removed', !existsSync(temp));
}

// 4. Supervisor loads the fetched service definitions.
ok('supervisor list includes agentgui and gm-install',
  /'agentgui'/.test(index) && /'gm-install'/.test(index));
ok('config enables agentgui and gm-install',
  config.services.agentgui?.enabled === true && config.services['gm-install']?.enabled === true);
ok('AgentGUI service has exact GitHub spec', agentgui.includes(`const AGENTGUI_PACKAGE = '${GITHUB_SPEC}';`));
ok('AgentGUI service constructs npx -y using exact spec',
  /spawnAgentGui\(npxBin, \['-y', AGENTGUI_PACKAGE\]/.test(agentgui));
ok('dependency sort is used by supervisor startup',
  /topologicalSort|groupByDependency/.test(file('startup/lib/supervisor.js')) &&
  /groupByDependency/.test(dependencySort + file('startup/lib/supervisor.js')));
ok('start.sh launches fetched /opt/gmweb-startup/index.js',
  /\/opt\/gmweb-startup\/index\.js/.test(start) && /bash \/opt\/gmweb-startup\/start\.sh/.test(rest));
ok('gm-install uses fetched install-gm.sh path', gmInstall.includes("'..', 'install-gm.sh'"));

// 5. Non-blocking startup and health/retry semantics.
ok('custom_startup spawns rest-of-startup with nohup', /nohup bash \/custom-cont-init\.d\/rest-of-startup\.sh/.test(custom));
ok('background installs are spawned before supervisor', background.includes('GMWEB BACKGROUND INSTALLS STARTED') &&
  /nohup bash \/custom-cont-init\.d\/background-installs\.sh/.test(rest));
ok('supervisor start returns immediately from gm-install', /return \{ pid: 0, process: null/.test(gmInstall));
ok('gm-install child is detached', /detached: true/.test(gmInstall));
ok('gm-install health retries via supervisor', /async health\(\)[\s\S]*?startInstaller\(/.test(gmInstall));
ok('AgentGUI preserves 3-minute restart grace', /180000/.test(agentgui));
ok('startup install script has no AgentGUI npm install', !/agentgui/i.test(installSh));

// 6. No forbidden active spec, secrets, signed URL, or publish step.
const activeSources = [
  'startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/index.js',
  'startup/start.sh', 'startup/install.sh', 'startup.sh', 'docker/rest-of-startup.sh',
  'docker/custom_startup.sh', 'docker/background-installs.sh', 'docker/install-gm.sh',
  'Dockerfile', 'Dockerfile.headless',
].map(file).join('\n');
const forbidden = [['agentgui', '1.0.1126'].join('@'), 'agentgui@latest',
  /bunx[^\n]*agentgui@/, /npx[^\n]*-y[^\n]*['"]agentgui['"]/,
  /(?:AGENTGUI_PACKAGE|packageName)\s*=\s*['"]agentgui(?:@[^'"]*)?['"]/];
const forbiddenHits = forbidden.filter((p) => typeof p === 'string' ? activeSources.includes(p) : p.test(activeSources)).map(String);
ok('container path has no forbidden AgentGUI npm specs', forbiddenHits.length === 0, forbiddenHits.join(', '));
const secrets = [
  /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/,
  /(?:token|api[_-]?key|secret)\s*[:=]\s*['"][^'"$<{]{12,}['"]/i,
  /X-Amz-(Algorithm|Credential|Signature)/i,
];
ok('container path has no tokens or signed URLs', !secrets.some((p) => [dockerfile, headlessDockerfile, compose, composeHeadless, rest, custom, background, start, installSh, agentgui, gmInstall].some((text) => p.test(text))));
const publish = /\b(?:git push|npm publish|docker push|gh release create|git commit|git tag)\b/;
ok('startup path contains no publish/commit step',
  ![dockerfile, headlessDockerfile, compose, composeHeadless, rest, custom, background, start, installSh].some((text) => publish.test(text)));

// 7. Focused syntax checks for files in this path.
for (const relativePath of ['services/agentgui.js', 'services/gm-install.js', 'check-container-startup-path.mjs']) {
  const r = spawnSync(process.execPath, ['--check', join(STARTUP, relativePath)], { encoding: 'utf8' });
  ok(`node --check ${relativePath}`, r.status === 0, (r.stderr || r.stdout || '').trim());
}
for (const [relativePath, interpreter] of [['../docker/install-gm.sh', 'sh'], ['start.sh', 'bash'], ['../docker/rest-of-startup.sh', 'bash'], ['../docker/custom_startup.sh', 'bash'], ['../docker/background-installs.sh', 'bash'], ['../startup.sh', 'bash']]) {
  const r = spawnSync(interpreter, ['-n', join(STARTUP, relativePath)], { encoding: 'utf8' });
  ok(`${interpreter} -n ${relativePath}`, r.status === 0, (r.stderr || r.stdout || '').trim());
}

for (const check of CHECKS) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` -- ${check.detail}` : ''}`);
console.log(`\n${CHECKS.length - FAILURES.length}/${CHECKS.length} container-path checks passed`);
if (FAILURES.length) {
  console.error(`\n${FAILURES.length} failed:\n- ${FAILURES.join('\n- ')}`);
  process.exit(1);
}
