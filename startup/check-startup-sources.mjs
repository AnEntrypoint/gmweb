#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GM_SOURCE = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const failures = [];
const checks = [];

function file(relative) {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function ok(name, condition, detail = '') {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function shellSyntax(relative, interpreter) {
  const result = spawnSync(interpreter, ['-n', join(ROOT, relative)], { encoding: 'utf8' });
  ok(`${interpreter} -n ${relative}`, result.status === 0, (result.stderr || result.stdout || '').trim());
}

function nodeSyntax(relative) {
  const result = spawnSync(process.execPath, ['--check', join(ROOT, relative)], { encoding: 'utf8' });
  ok(`node --check ${relative}`, result.status === 0, (result.stderr || result.stdout || '').trim());
}

const activeFiles = [
  'startup/services/agentgui.js',
  'startup/services/gm-install.js',
  'startup/index.js',
  'startup/config.json',
  'startup/start.sh',
  'startup.sh',
  'docker/rest-of-startup.sh',
  'docker/background-installs.sh',
  'docker/custom_startup.sh',
  'docker/install-gm.sh',
];
const activeCode = activeFiles.filter(f => /\.(js|mjs|sh)$/.test(f)).map(f => stripComments(file(f))).join('\n');
const agentgui = file('startup/services/agentgui.js');
const agentguiCode = stripComments(agentgui);
const gmInstall = file('startup/services/gm-install.js');
const gmInstallCode = stripComments(gmInstall);
const installer = file('docker/install-gm.sh');
const upstream = existsSync(GM_SOURCE)
  ? readFileSync(GM_SOURCE, 'utf8')
  : null;

// (a) No active AgentGUI npm pin or bare npm spec remains.
const npmSpecPattern = /(?:AGENTGUI_PACKAGE|packageName\s*=)\s*['"`]agentgui(?:@[^'"`]*)?['"`]|spawn\([^)]*,\s*\[\s*(?:['"`]-y['"`]\s*,\s*)?['"`]agentgui(?:@[^'"`]*)?['"`]/;
ok('AgentGUI has no npm package spec in active startup code', !npmSpecPattern.test(activeCode), 'checked package assignments and spawn arguments');
const retiredPin = ['agentgui', '1.0.1126'].join('@');
ok('old pinned AgentGUI version is absent from active code', !activeCode.includes(retiredPin));
ok('AGENTGUI_PACKAGE is a GitHub source', /AGENTGUI_PACKAGE\s*=\s*['"]github:AnEntrypoint\/agentgui#main['"]/.test(agentguiCode));

// (b) Every AgentGUI npx invocation uses github:.
const npxLines = activeCode.split('\n').filter(line => /npx/.test(line) && /agentgui|AGENTGUI_PACKAGE/i.test(line));
ok('AgentGUI npx invocation found', npxLines.length > 0);
const agentGuiSpawnPattern = /(?:spawn|spawnAgentGui)\(\s*npxBin\s*,\s*\[\s*['"]-y['"]\s*,\s*AGENTGUI_PACKAGE\s*\]/;
ok('AgentGUI npx uses -y and AGENTGUI_PACKAGE', agentGuiSpawnPattern.test(agentguiCode));
ok('AgentGUI spawn wrapper delegates to child_process spawn', /function spawnAgentGui\([^)]*\)[\s\S]*?return \(testSpawn \|\| spawn\)\(bin, args, options\)/.test(agentguiCode));
ok('All AgentGUI npx specs are github:', npxLines.every(line => !/['"]agentgui(?:@[^'"]*)?['"]/.test(line)));
ok('Docs state the github: rule', /any `npx` invocation for AgentGUI must use `github:` syntax/i.test(file('GM_INSTALL.md')));

// (c) gm installer/URL/manifest/sha/size/register/auto-update logic.
const canonicalUrl = 'https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh';
const releaseBase = 'https://github.com/AnEntrypoint/gm/releases/download/latest';
ok('gm-install invokes the canonical installer URL', gmInstallCode.includes(canonicalUrl));
ok('gm installer default release base matches upstream', installer.includes(releaseBase));
const installerTokens = [
  '$RELEASE_BASE/manifest.json',
  'sha256sum',
  'shasum -a 256',
  'EXPECTED_SHA',
  'ACTUAL_SHA',
  'EXPECTED_SIZE',
  'ACTUAL_SIZE',
  '$HOME/.gmnew',
  '$INSTALL_ROOT/current',
  '.gmnew-update.json',
  'GMNEW_SKIP_REGISTER',
  '"$EXE" install',
  '--mcp-config',
];
for (const token of installerTokens) ok(`installer contains ${token}`, installer.includes(token));
ok('gm-install writes/uses auto-update state', gmInstallCode.includes('GMNEW_AUTO_UPDATE') && gmInstallCode.includes('.gmnew-update.json'));
ok('gm-install does not use stale add-mcp registration', !/add-mcp/.test(gmInstallCode));
ok('installer does not use stale add-mcp registration', !/^[ \t]*(?!#).*add-mcp/m.test(installer));
ok('gm-install documents 15-minute auto-update', /15 minutes/.test(file('GM_INSTALL.md')) && /GMNEW_AUTO_UPDATE=0/.test(file('GM_INSTALL.md')));
ok('GM_INSTALL documents canonical --mcp-config command', file('GM_INSTALL.md').includes(`sh -s -- --mcp-config <path>`));

if (upstream) {
  // Explicit behavioral signature: compare canonical executable statements, not
  // comments. Allowed gmweb-only differences are documented in GM_INSTALL.md:
  // docker/install-gm.sh:1-4 is a provenance header and its trailing two
  // comments describe gmweb's detached supervisor/native auto-update.
  const behavioralLines = (text) => text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('#!'))
    .filter((line) => !line.startsWith('RELEASE_BASE='))
    .filter((line) => !line.includes('https://raw.githubusercontent.com'))
    .join('\n');
  const expectedBehavior = behavioralLines(upstream);
  const actualBehavior = behavioralLines(installer);
  ok('vendored installer behavioral signature matches /workspace/gm/scripts/install.sh',
    expectedBehavior === actualBehavior,
    expectedBehavior === actualBehavior ? '' : 'behavioral statements differ');
  const canonicalMarkers = [
    'curl --retry 3 --retry-delay 1 --retry-all-errors -fsSL -o "$WORK/manifest.json" "$RELEASE_BASE/manifest.json"',
    'case "$(uname -s)" in',
    'case "$(uname -m)" in',
    'TARGET="$ARCH-$OS"',
    'PACKAGE="gmnew-$TARGET"',
    'EXPECTED_SHA="$2"',
    'EXPECTED_SIZE="$3"',
    '[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]',
    '[ "$ACTUAL_SIZE" = "$EXPECTED_SIZE" ]',
    'STAGE="$(mktemp -d "$INSTALL_ROOT/stage.XXXXXX")"',
    'swap_in "$STAGE/$PACKAGE" "$VERSION"',
    'ln -sfn "versions/$NEW_ID" "$INSTALL_ROOT/current.next"',
    'mv $MV_NOFOLLOW "$INSTALL_ROOT/current.next" "$CURRENT_DIR"',
    'STATE="$CURRENT_DIR/.gmnew-update.json"',
    'GMNEW_SKIP_REGISTER',
    '"$EXE" install --mcp-config "$MCP_CONFIG"',
    '"$EXE" install || die "gm install failed"',
    'register',
  ];
  for (const marker of canonicalMarkers) {
    ok(`canonical installer behavior: ${marker}`, expectedBehavior.includes(marker) && actualBehavior.includes(marker));
  }
  ok('GM_INSTALL documents exact-copy parity rule',
    /exact copy/i.test(file('GM_INSTALL.md')) && /behavioral signature/i.test(file('GM_INSTALL.md')) &&
    /GM_SOURCE/.test(file('GM_INSTALL.md')));
} else {
  ok('upstream gm installer available for exact comparison', false, `${GM_SOURCE} not found`);
}

// (d) Startup remains non-blocking and supervised retries are available.
ok('gm-install start detaches installer', /detached:\s*true/.test(gmInstallCode));
ok('gm-install start does not await the installer', /async start\(env\)[\s\S]*?return \{ pid: 0/.test(gmInstallCode));
ok('health checks retry installation', /async health\(\)[\s\S]*?startInstaller\(/.test(gmInstallCode));
ok('service registered in supervisor', file('startup/index.js').includes("'gm-install'"));
ok('service enabled in config', JSON.parse(file('startup/config.json')).services['gm-install']?.enabled === true);
ok('blocking startup leaves slow work async', /nohup bash \/custom-cont-init\.d\/rest-of-startup\.sh/.test(file('docker/custom_startup.sh')));
ok('rest-of-startup starts supervisor without waiting on background installs', /Background installs continue async/.test(file('docker/rest-of-startup.sh')));

// (e) No obvious secrets/tokens in changed source and docs.
const secretTargets = [
  'startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/check-runtime-install.mjs', 'startup/index.js',
  'startup/config.json', 'docker/install-gm.sh', 'docker/rest-of-startup.sh',
  'GM_INSTALL.md', 'SETUP.md', 'readme.md', 'AGENTS.md', 'CLAUDE.md',
  'AGENTGUI_STATUS.md', 'AGENTGUI_FINAL_STATUS.md',
];
const secretPatterns = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(?:token|api[_-]?key|secret)\s*[:=]\s*['"][^'"$<{]{12,}['"]/i,
];
for (const relative of secretTargets) {
  const text = file(relative);
  ok(`no secret literals in ${relative}`, !secretPatterns.some(pattern => pattern.test(text)));
}

// (f) Focused syntax/parser checks.
for (const relative of [
  'startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/check-runtime-install.mjs', 'startup/index.js',
  'startup/lib/service-utils.js', 'startup/lib/service-templates.js',
]) nodeSyntax(relative);
for (const relative of ['startup/start.sh', 'startup.sh', 'docker/rest-of-startup.sh', 'docker/background-installs.sh', 'docker/custom_startup.sh']) shellSyntax(relative, 'bash');
shellSyntax('docker/install-gm.sh', 'sh');
const parseJson = spawnSync(process.execPath, ['-e', 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))', join(ROOT, 'startup/config.json')], { encoding: 'utf8' });
ok('startup/config.json parses', parseJson.status === 0, (parseJson.stderr || '').trim());

for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` -- ${check.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
