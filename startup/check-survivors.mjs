#!/usr/bin/env node
// Deterministic survivor scan for bounded gates. Excludes this process tree
// and checker command lines; fails only on real service/install survivors.
import { spawnSync } from 'child_process';
const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
const own = String(process.pid);
const parent = String(process.ppid);
const survivors = (ps.stdout || '').split('\n').filter((line) => {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith(`${own} `) || trimmed.startsWith(`${parent} `)) return false;
  if (/check-release-readiness|check-hidden-tokens|check-survivors/.test(line)) return false;
  return /github:AnEntrypoint\/agentgui#main|GM_INSTALL_DRY_RUN=1|gmweb-simulated-startup-|gmweb-container-path-|live-post-restart-probe\.mjs/.test(line);
});
if (survivors.length) {
  console.error(survivors.join('\n'));
  process.exit(1);
}
console.log('no survivor processes');
