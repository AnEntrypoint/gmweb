#!/usr/bin/env node
// Bounded drift watcher. Default: 10 minutes, 15s interval, --once for one
// deterministic iteration. It never copies or modifies gm/gmweb source.
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GM_SOURCE = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const VENDORED = join(ROOT, 'docker/install-gm.sh');
const argv = process.argv.slice(2);
const once = argv.includes('--once');
const intervalMs = Math.min(60000, Math.max(1000, Number(process.env.GMWEB_DRIFT_INTERVAL_MS || 15000)));
const durationMs = once ? 0 : Math.min(600000, Math.max(intervalMs, Number(process.env.GMWEB_DRIFT_DURATION_MS || 600000)));
const driftCheck = join(ROOT, 'scripts/check-gm-upstream-drift.mjs');
const report = join(ROOT, 'startup/rollout-report.mjs');
const sleep = spawnSync ? (ms) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`], { timeout: ms + 1000 }) : () => {};
function sha(path) { return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'MISSING'; }
function runNode(script) { return spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8', timeout: 20000 }); }

let previous = sha(GM_SOURCE);
const started = Date.now();
let iterations = 0;
let lastStatus = 0;
let lastAction = 'NONE';
for (;;) {
  iterations++;
  const current = sha(GM_SOURCE);
  const changed = current !== previous;
  const drift = runNode(driftCheck);
  lastStatus = Number(drift.status ?? 1);
  if (lastStatus !== 0) {
    lastAction = `MANUAL_ACTION cp ${GM_SOURCE} ${VENDORED}; then npm run report:rollout && npm run validate:rollout-report`;
    console.error(`WATCH_DRIFT_DETECTED iteration=${iterations} gm_sha=${current} gmweb_sha=${sha(VENDORED)} action=${lastAction}`);
  } else if (changed) {
    lastAction = 'REPORT_REGENERATED';
    const regenerated = runNode(report);
    lastStatus = Number(regenerated.status ?? 1);
    console.log(`WATCH_GM_CHANGED iteration=${iterations} gm_sha=${current} report_exit=${lastStatus}`);
  } else {
    lastAction = 'NONE';
  }
  previous = current;
  if (once || Date.now() - started >= durationMs) break;
  sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - started))));
}
console.log(`WATCH_RESULT once=${once} iterations=${iterations} interval_ms=${intervalMs} duration_ms=${durationMs} gm_sha=${previous} drift_exit=${lastStatus} action=${lastAction}`);
console.log('WATCH_GUARANTEE no files copied; no gm/gmweb source modified; no install/registration/restart/publish');
process.exit(lastStatus === 0 ? 0 : 1);
