#!/usr/bin/env node
// Validate docs/ROLLOUT_REPORT.json against live files/gates. Offline only.
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_JSON = join(ROOT, 'docs/ROLLOUT_REPORT.json');
const REPORT_MD = join(ROOT, 'docs/ROLLOUT_REPORT.md');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function run(command, args, cwd = ROOT) { return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20000 }); }
function file(path) { return readFileSync(join(ROOT, path), 'utf8'); }

ok('report JSON exists', existsSync(REPORT_JSON));
ok('report Markdown exists', existsSync(REPORT_MD));
if (!existsSync(REPORT_JSON) || !existsSync(REPORT_MD)) { console.log('0/2 report-validation checks passed'); process.exit(1); }
const report = JSON.parse(readFileSync(REPORT_JSON, 'utf8'));
const md = readFileSync(REPORT_MD, 'utf8');
const upstreamSha = sha('/workspace/gm/scripts/install.sh');
const vendoredSha = sha(join(ROOT, 'docker/install-gm.sh'));
const agentgui = file('startup/services/agentgui.js');
const activeSpec = agentgui.match(/const AGENTGUI_PACKAGE = '([^']+)'/)?.[1];

ok('report ok is true', report.ok === true, String(report.ok));
ok('report schema includes releaseReadiness', report.schema >= 4 && report.releaseReadiness?.command === 'npm run check:release-readiness' && report.releaseReadiness?.validator === 'npm run validate:release-readiness' && report.releaseReadiness?.offline === true && report.releaseReadiness?.boundedWatch?.modifiesFiles === false);
ok('release readiness artifacts exist', (report.releaseReadiness?.artifacts || []).every((p) => existsSync(join(ROOT, p))) && /RELEASE_READINESS/.test(md));
ok('report schema includes simulatedStartup', report.schema >= 3 && report.simulatedStartup?.status === 'PASS' && report.simulatedStartup?.noNetwork === true && report.simulatedStartup?.cleanup === true && report.simulatedStartup?.timeoutMsMax < 20000);
ok('report simulatedStartup exact command and output', report.simulatedStartup?.command === 'npm run simulate:startup' && report.simulatedStartup?.output === 'docs/SIMULATED_STARTUP_OUTPUT.txt' && existsSync(join(ROOT, report.simulatedStartup.output)));
ok('report simulatedStartup evidence fields', /SUPERVISOR_READY/.test(report.simulatedStartup?.supervisorFirstEvidence || '') && /dry_run=1/.test(report.simulatedStartup?.gmInstallDryRunEvidence || '') && report.simulatedStartup?.agentGuiSpec === 'npx -y github:AnEntrypoint/agentgui#main');
ok('report contains simulation gates', (report.gates || []).some((g) => g.name === 'simulated-startup' && g.ok) && (report.gates || []).some((g) => g.name === 'simulated-startup-gate' && g.ok));
ok('report schema includes postRestartProbe', report.schema >= 2 && report.postRestartProbe?.offlineByDefault === true && report.postRestartProbe?.timeoutMsMax === 2000);
ok('report postRestartProbe statuses and fixtures', JSON.stringify(report.postRestartProbe?.statuses) === JSON.stringify(['SELFTEST','PASS','FAIL','UNAVAILABLE']) && report.postRestartProbe?.fixtures?.healthy === 'PASS' && report.postRestartProbe?.fixtures?.['stale-npm-pin'] === 'FAIL' && report.postRestartProbe?.fixtures?.unreachable === 'UNAVAILABLE');
ok('report contains live-probe gates', (report.gates || []).some((g) => g.name === 'live-probe-selftest' && g.ok) && (report.gates || []).some((g) => g.name === 'live-probe-fixtures' && g.ok));
ok('report has generatedAt', typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)));
ok('report installer hashes match live files', report.gm?.installerSha256 === upstreamSha && report.installer?.vendoredSha256 === vendoredSha);
ok('installer byte parity is live', upstreamSha === vendoredSha && report.installer?.byteParity === true);
ok('report active AgentGUI spec matches live file', activeSpec === 'github:AnEntrypoint/agentgui#main' && report.agentGui?.activeSpec === activeSpec);
ok('report rollout commands are exact', report.rollout?.productionCommand === 'docker compose restart gmweb' && report.rollout?.headlessCommand === 'docker compose -f docker-compose.headless.yaml restart gmweb-headless');
ok('report Markdown states ok true', /ok: true/.test(md));
ok('report gates all passed', Array.isArray(report.gates) && report.gates.every((g) => g.ok === true && g.exitCode === 0 && g.passed === g.total), JSON.stringify(report.gates?.map((g) => [g.name, g.count, g.exitCode])));
ok('report contains offline/live post-restart status', report.postRestart?.offlineStatus === 'OFFLINE_PLAN_VALID' && ['UNAVAILABLE', 'LIVE_VERIFIED'].includes(report.postRestart?.liveStatus));

// Re-run each reported gate and compare its live count/status.
const patterns = {
  'static-source': /(\d+)\/(\d+) checks passed/,
  'runtime-install': /(\d+)\/(\d+) runtime checks passed/,
  'container-startup-path': /(\d+)\/(\d+) container-path checks passed/,
  'rollout-docs': /(\d+)\/(\d+) rollout-docs checks passed/,
  'post-restart-offline': /(\d+)\/(\d+) post-restart checks passed; STATUS=([A-Z_]+)/,
  'post-restart-live': /(\d+)\/(\d+) post-restart checks passed; STATUS=([A-Z_]+)/,
  'gm-upstream-drift': /(\d+)\/(\d+) gm-drift checks passed/,
  'live-probe-selftest': /PROBE_CHECKS (\d+)\/(\d+)[\s\S]*?STATUS=([A-Z_]+)/,
  'live-probe-fixtures': /(\d+)\/(\d+) live-probe fixture checks passed/,
  'simulated-startup': /(\d+)\/(\d+) simulated-startup checks passed[\s\S]*?SIMULATED_STARTUP_STATUS=([A-Z_]+)/,
  'simulated-startup-gate': /(\d+)\/(\d+) simulated-startup gate checks passed[\s\S]*?SIMULATED_STARTUP_GATE=([A-Z_]+)/,
};
for (const gate of report.gates || []) {
  const def = Object.entries(patterns).find(([name]) => name === gate.name);
  ok(`report gate known: ${gate.name}`, Boolean(def));
  if (!def) continue;
  const [command, ...args] = gate.command.split(' ');
  const r = run(command, args);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = out.match(def[1]);
  const liveCount = m ? `${m[1]}/${m[2]}` : 'UNAVAILABLE';
  ok(`report gate count matches live: ${gate.name}`, r.status === 0 && liveCount === gate.count, `${gate.count} vs ${liveCount}`);
  if (m?.[3]) ok(`report gate status matches live: ${gate.name}`, m[3] === gate.status, `${gate.status} vs ${m[3]}`);
}

// Docs links and deterministic safety checks.
for (const [doc, link] of [['docs/POST-RESTART.md', 'ROLLOUT_REPORT'], ['docs/CONTAINER-ROLLOUT.md', 'ROLLOUT_REPORT'], ['GM_INSTALL.md', 'ROLLOUT_REPORT'], ['readme.md', 'ROLLOUT_REPORT']]) {
  ok(`${doc} links rollout report`, file(doc).includes(link));
}
const forbidden = [['agentgui', '1.0.1126'].join('@'), 'agentgui@latest', /bunx[^\n]*agentgui@/, /npx[^\n]*-y[^\n]*['"]agentgui['"]/];
const activeSources = ['startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/index.js', 'docker/rest-of-startup.sh', 'docker/install-gm.sh'].map(file).join('\n');
ok('no forbidden active AgentGUI npm spec', !forbidden.some((p) => typeof p === 'string' ? activeSources.includes(p) : p.test(activeSources)));

const secretPatterns = [/gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /X-Amz-(Algorithm|Credential|Signature)/i, /(?:token|api[_-]?key|secret)\s*[:=]\s*['"][^'"$<{]{12,}['"]/i];
const secretTargets = ['docs/ROLLOUT_REPORT.json', 'docs/ROLLOUT_REPORT.md', 'docs/POST-RESTART.md', 'docs/CONTAINER-ROLLOUT.md', 'GM_INSTALL.md', 'readme.md', 'docs/SIMULATED_STARTUP_OUTPUT.txt', 'docs/RELEASE_READINESS.json', 'docs/RELEASE_READINESS.md', 'package.json', 'startup/package.json'];
ok('hidden-token scan clean on report/docs/manifests', !secretTargets.some((p) => secretPatterns.some((q) => q.test(file(p)))));

for (const relative of ['startup/services/agentgui.js', 'startup/services/gm-install.js', 'startup/rollout-report.mjs', 'startup/validate-rollout-report.mjs', 'startup/watch-gm-drift.mjs', 'startup/live-post-restart-probe.mjs', 'startup/check-live-probe-fixtures.mjs', 'startup/simulate-container-startup.mjs', 'startup/check-simulated-startup.mjs', 'startup/check-release-readiness.mjs', 'startup/validate-release-readiness.mjs', 'startup/check-hidden-tokens.mjs', 'startup/check-survivors.mjs']) {
  const r = run(process.execPath, ['--check', join(ROOT, relative)]);
  ok(`node --check ${relative}`, r.status === 0, (r.stderr || '').trim());
}
for (const relative of ['startup/start.sh', 'startup.sh', 'docker/rest-of-startup.sh', 'docker/custom_startup.sh', 'docker/background-installs.sh']) {
  const r = run('bash', ['-n', join(ROOT, relative)]);
  ok(`bash -n ${relative}`, r.status === 0, (r.stderr || '').trim());
}
const shCheck = run('sh', ['-n', join(ROOT, 'docker/install-gm.sh')]);
ok('sh -n docker/install-gm.sh', shCheck.status === 0, (shCheck.stderr || '').trim());
ok('git diff --check', run('git', ['diff', '--check'], ROOT).status === 0);

const ps = run('ps', ['-eo', 'pid=,args=']);
const ownPid = String(process.pid);
const ownParentPid = String(process.ppid);
const fixtureGate = run(process.execPath, ['startup/check-live-probe-fixtures.mjs', 'startup/simulate-container-startup.mjs', 'startup/check-simulated-startup.mjs', 'startup/check-release-readiness.mjs', 'startup/validate-release-readiness.mjs', 'startup/check-hidden-tokens.mjs', 'startup/check-survivors.mjs']);
ok('live-probe fixture gate passes', Number(fixtureGate.status) === 0 && /16\/16 live-probe fixture checks passed/.test(fixtureGate.stdout || ''));
const probeSelfTest = run(process.execPath, ['startup/live-post-restart-probe.mjs']);
ok('live-probe SELFTEST passes', Number(probeSelfTest.status) === 0 && /STATUS=SELFTEST/.test(probeSelfTest.stdout || ''));
const simGate = run(process.execPath, ['startup/check-simulated-startup.mjs', 'startup/check-release-readiness.mjs', 'startup/validate-release-readiness.mjs', 'startup/check-hidden-tokens.mjs', 'startup/check-survivors.mjs']);
ok('simulated-startup gate passes', Number(simGate.status) === 0 && /13\/13 simulated-startup gate checks passed/.test(simGate.stdout || ''));
const isOwnTree = (line) => line.trimStart().startsWith(`${ownPid} `) || line.trimStart().startsWith(`${ownParentPid} `) || line.includes(`validate-rollout-report.mjs`);
const survivors = (ps.stdout || '').split('\n').filter((line) => !isOwnTree(line) && /github:AnEntrypoint\/agentgui#main|GM_INSTALL_DRY_RUN=1|gmweb-container-path-|rollout-report\.mjs|watch-gm-drift\.mjs/.test(line));
ok('no survivor processes from report/gates', survivors.length === 0, survivors.join(' | '));

for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} rollout-report validation checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('ROLLOUT_REPORT_VALID ok=true path=docs/ROLLOUT_REPORT.json');
