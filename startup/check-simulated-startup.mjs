#!/usr/bin/env node
// Deterministic checker for simulate-container-startup.mjs; writes the exact
// command/output artifact used by docs and the rollout report.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM = join(ROOT, 'startup/simulate-container-startup.mjs');
const OUTPUT = join(ROOT, 'docs/SIMULATED_STARTUP_OUTPUT.txt');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function run(args, timeout = 15000) { return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout }); }
const command = `${process.execPath} startup/simulate-container-startup.mjs`;
const sim = run(['startup/simulate-container-startup.mjs']);
const out = `${sim.stdout || ''}\n${sim.stderr || ''}`;
const count = out.match(/(\d+)\/(\d+) simulated-startup checks passed/);
const status = out.match(/SIMULATED_STARTUP_STATUS=([A-Z_]+)/)?.[1] || 'FAIL';
ok('simulation exits 0', Number(sim.status) === 0, `exit=${sim.status}`);
ok('simulation reports PASS', status === 'PASS');
ok('simulation reports 19/19', count?.[1] === '19' && count?.[2] === '19', count?.[0] || 'no count');
ok('simulation proves supervisor-first', /supervisor\/dependency sort starts before background installer/.test(out));
ok('simulation proves AgentGUI GitHub spawn', /AGENTGUI_SPAWN \{"bin":"[^"]*npx","args":\["-y","github:AnEntrypoint\/agentgui#main"\]/.test(out));
ok('simulation proves gm dry run', /GM_DRY_RUN_EVIDENCE dry_run=1 registration_skipped=1 detached=true/.test(out) && /GM_DRY_RUN_COMMAND "sh" detached=true/.test(out));
ok('simulation proves temp cleanup', /temporary workspace cleaned/.test(out) && /tempDirHandling=removed/.test(out));
ok('simulation proves no network/MCP/install/survivors', /noNetwork=true noMCP=true noInstall=true noSurvivors=true/.test(out));
ok('simulation timeout bounded below 20s', Number(out.match(/timeout_ms=(\d+)/)?.[1] || 99999) < 20000);
ok('simulation source uses argv mocks only', /spawnSync\(process\.execPath/.test(readFileSync(SIM, 'utf8')) && !/execSync\(/.test(readFileSync(SIM, 'utf8')));
ok('simulation output has no secrets/signed URLs', !/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|X-Amz-(Algorithm|Credential|Signature)|-----BEGIN .*PRIVATE KEY-----/i.test(out));
const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
const survivors = (ps.stdout || '').split('\n').filter((line) => line.includes('gmweb-simulated-startup-') && !line.includes('check-simulated-startup.mjs'));
ok('no simulation temp process survives', survivors.length === 0, survivors.join(' | '));
const outputText = `# Simulated startup output\n\nCommand: ${command}\nExit: ${sim.status}\nStatus: ${status}\nChecks: ${count?.[0] || 'UNAVAILABLE'}\n\n\`\`\`text\n${out.trim()}\n\`\`\`\n`;
writeFileSync(OUTPUT, outputText);
ok('simulation output artifact written', existsSync(OUTPUT) && readFileSync(OUTPUT, 'utf8').includes(`Command: ${command}`));
for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} simulated-startup gate checks passed`);
console.log(`SIMULATED_STARTUP_GATE=${failures.length ? 'FAIL' : 'PASS'} output=docs/SIMULATED_STARTUP_OUTPUT.txt`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
