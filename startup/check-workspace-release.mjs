#!/usr/bin/env node
// Read-only cross-workspace release context. Never writes peer files, never
// restarts containers, never contacts network, installs, registers, or publishes.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(ROOT, '..');
const argv = process.argv.slice(2);
const once = argv.includes('--once');
const watch = argv.includes('--watch');
const INTERVAL_MS = Math.min(60000, Math.max(1000, Number(process.env.GMWEB_WORKSPACE_WATCH_INTERVAL_MS || 20000)));
const DURATION_MS = once ? 0 : Math.min(600000, Math.max(INTERVAL_MS, Number(process.env.GMWEB_WORKSPACE_WATCH_DURATION_MS || 600000)));
const JSON_OUT = join(ROOT, 'docs/WORKSPACE_RELEASE.json');
const MD_OUT = join(ROOT, 'docs/WORKSPACE_RELEASE.md');
const GM_INSTALLER = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';

function sha(path) { return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null; }
function json(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { return { __parseError: error.message }; }
}
function presentRows(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const keys = ['checks', 'gates', 'results', 'commands', 'statuses'];
  return keys.flatMap((key) => Array.isArray(obj[key]) ? obj[key] : []);
}
function redGates(obj) {
  if (!obj || obj.__parseError) return obj?.__parseError ? [`parse:${obj.__parseError}`] : [];
  const rows = presentRows(obj);
  const bad = rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const code = row.exit ?? row.exitCode ?? row.status ?? row.ok;
    if (code === false || code === 'FAIL' || code === 'BLOCKING') return true;
    return typeof code === 'number' && code !== 0 && code !== 1;
  });
  if (obj.ok === false) bad.push({ label: 'artifact.ok=false' });
  if (obj.summary?.blocked > 0) bad.push({ label: `summary.blocked=${obj.summary.blocked}` });
  if (obj.counts?.blocked > 0 && obj.ok === false) bad.push({ label: `counts.blocked=${obj.counts.blocked}` });
  if (obj.counts?.unexplainedUnavailable > 0) bad.push({ label: `counts.unexplainedUnavailable=${obj.counts.unexplainedUnavailable}` });
  return bad.map((row) => row.label || row.name || row.command || JSON.stringify(row));
}
function counts(obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (obj.gateCounts && typeof obj.gateCounts === 'object') return obj.gateCounts;
  if (obj.counts && typeof obj.counts === 'object') return obj.counts;
  if (obj.summary && typeof obj.summary === 'object') return obj.summary;
  const numeric = Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'number'));
  const rows = presentRows(obj);
  if (rows.length) numeric.gates = rows.length;
  return numeric;
}
function hashFields(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const key of ['snapshotHash', 'hash', 'fingerprint', 'sourceFingerprint', 'installerSha256', 'vendoredInstallerSha256', 'destinationHashSweep', 'contentHash']) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
function readArtifact(name, relativeOrAbsolute, options = {}) {
  const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : join(WORKSPACE, relativeOrAbsolute);
  const isPresent = existsSync(path);
  const obj = isPresent ? json(path) : null;
  const parseError = obj?.__parseError || null;
  const red = redGates(obj);
  const okValue = isPresent && !parseError ? (obj?.ok === undefined ? red.length === 0 : obj.ok === true) : null;
  let status = !isPresent ? 'UNAVAILABLE' : parseError ? 'BLOCKING' : red.length ? 'BLOCKING' : okValue ? 'PASS' : 'BLOCKING';
  let nextAction = options.nextAction || (status === 'UNAVAILABLE' ? 'Wait for peer artifact; no gmweb action' : 'None');
  let blocking = status === 'BLOCKING';
  if (options.pendingWhenMissing && status === 'UNAVAILABLE') {
    status = 'PENDING';
    nextAction = options.pendingAction || nextAction;
    blocking = false;
  }
  if (options.pendingWhenPresent && status === 'PASS' && options.pendingWhenPresent(obj)) {
    status = 'PENDING';
    nextAction = options.pendingAction || nextAction;
    blocking = false;
  }
  return {
    name,
    path,
    present: isPresent,
    ok: okValue,
    status,
    blocking,
    counts: counts(obj),
    sha256: sha(path),
    hashes: hashFields(obj),
    redGates: red,
    nextAction,
  };
}

function build() {
  const artifacts = [
    readArtifact('gmweb-release-readiness', join(ROOT, 'docs/RELEASE_READINESS.json'), { nextAction: 'None; rolloutAction READY' }),
    readArtifact('oscraft-release', '/workspace/oscraft/docs/OSCRAFT_RELEASE.json', { nextAction: 'None' }),
    readArtifact('bitvoice-release', '/workspace/bitvoice/docs/BITVOICE_RELEASE.json', { nextAction: 'Generate Bitvoice release artifact when ready' }),
    readArtifact('bitvoice-service-contract', '/workspace/bitvoice/service-contract.json', { nextAction: 'Use as fallback contract until release artifact exists' }),
    readArtifact('bitvoice-lock', '/workspace/bitvoice/bitvoice.lock', { nextAction: 'Generate lock when peer release is finalized' }),
    readArtifact('wscheppity-extraction', '/workspace/wscheppity/.local/extraction-manifest.json', { nextAction: 'None' }),
    readArtifact('wscheppity-vendor-ready', '/workspace/wscheppity/.local/vendor-prep/READY.json', {
      pendingWhenMissing: true,
      pendingAction: '247420 vendors wscheppity only after READY.json ok=true; no gmweb action',
      pendingWhenPresent: (obj) => obj?.ok !== true,
    }),
    readArtifact('extra-extraction', '/workspace/extra/.local/extraction-manifest.json', { nextAction: 'None' }),
    readArtifact('extra-status', '/workspace/extra/.local/extraction-status.json', { nextAction: 'Generate status when extraction finalizes' }),
    readArtifact('bota-coordination', '/workspace/bota/export/coordination-status.json', { nextAction: 'None' }),
    readArtifact('hy3d-content', '/workspace/hy3d/output/content-for-bota.json', { nextAction: 'None' }),
    readArtifact('hy3d-delivery', '/workspace/hy3d/output/asset-delivery-report.json', { nextAction: 'None' }),
  ];
  const byName = Object.fromEntries(artifacts.map((a) => [a.name, a]));
  const bitvoiceOk = byName['bitvoice-release'].status === 'PASS' ||
    (byName['bitvoice-service-contract'].status === 'PASS' && byName['bitvoice-lock'].status === 'UNAVAILABLE' && byName['bitvoice-release'].status === 'UNAVAILABLE');
  const coreOk = byName['gmweb-release-readiness'].status === 'PASS' && byName['oscraft-release'].status === 'PASS' && bitvoiceOk;
  const ok = coreOk && artifacts.every((a) => !a.blocking);
  const sourceFingerprint = createHash('sha256').update(JSON.stringify({
    gmInstaller: sha(GM_INSTALLER),
    rows: artifacts.map((a) => [a.path, a.present, a.sha256]),
  })).digest('hex');
  const gmHeadRun = spawnSync('git', ['-C', '/workspace/gm', 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const gmStatusRun = spawnSync('git', ['-C', '/workspace/gm', 'status', '--short'], { encoding: 'utf8' });
  const report = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    ok,
    sourceFingerprint,
    mode: 'read-only-peer-artifacts',
    core: {
      gmweb: byName['gmweb-release-readiness'].status,
      oscraft: byName['oscraft-release'].status,
      bitvoice: bitvoiceOk ? 'PASS_OR_FALLBACK' : 'BLOCKING',
    },
    decision: ok ? 'WORKSPACE_CONTEXT_OK: gmweb release readiness remains READY; peers are reported but not modified' : 'BLOCKED: present peer artifact is red or inconsistent',
    gm: { head: gmHeadRun.status === 0 ? gmHeadRun.stdout.trim() : 'UNAVAILABLE', dirty: gmStatusRun.status === 0 && gmStatusRun.stdout.trim().length > 0, installerSha256: sha(GM_INSTALLER) },
    artifacts,
    pending: artifacts.filter((a) => a.status === 'PENDING').map((a) => a.name),
    unavailable: artifacts.filter((a) => a.status === 'UNAVAILABLE').map((a) => a.name),
    blocking: artifacts.filter((a) => a.blocking).map((a) => `${a.name}:${a.redGates.join(',')}`),
    guarantees: ['read-only peers', 'no network', 'no install', 'no MCP registration', 'no restart', 'no publish', 'no long-lived service'],
  };
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# Workspace release context', '', `Generated: ${report.generatedAt}`, `ok: ${ok}`, `decision: ${report.decision}`,
    `sourceFingerprint: \`${report.sourceFingerprint}\``, `gm HEAD: \`${report.gm.head}\`${report.gm.dirty ? ' (dirty worktree)' : ''}`,
    `gm installer SHA256: \`${report.gm.installerSha256}\``, '', '## Peer artifacts', '',
    '| name | status | ok | blocking | hash | next action |', '|---|---|---|---|---|---|',
    ...artifacts.map((a) => `| ${a.name} | ${a.status} | ${a.ok} | ${a.blocking} | ${a.sha256 ? a.sha256.slice(0, 12) : 'none'} | ${a.nextAction.replace(/\|/g, '\\|')} |`),
    '', `PENDING: ${report.pending.join(', ') || 'none'}`, `UNAVAILABLE: ${report.unavailable.join(', ') || 'none'}`, `BLOCKING: ${report.blocking.join(', ') || 'none'}`,
    '', 'Command: `npm run check:workspace-release -- --watch --once`; validator: `npm run validate:workspace-release`.',
    'This packet reads peer artifacts only. Missing optional artifacts are informational; present red artifacts block.',
  ];
  writeFileSync(MD_OUT, `${lines.join('\n')}\n`);
  console.log(`WORKSPACE_RELEASE ok=${ok} json=docs/WORKSPACE_RELEASE.json md=docs/WORKSPACE_RELEASE.md pending=${report.pending.join(',') || 'none'} unavailable=${report.unavailable.join(',') || 'none'} blocking=${report.blocking.join(',') || 'none'}`);
  return report;
}

function validExisting(fingerprint) {
  if (!existsSync(JSON_OUT)) return false;
  try {
    const a = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
    return a.ok === true && a.sourceFingerprint === fingerprint;
  } catch { return false; }
}
function currentFingerprint() {
  const paths = [
    join(ROOT, 'docs/RELEASE_READINESS.json'), '/workspace/oscraft/docs/OSCRAFT_RELEASE.json',
    '/workspace/bitvoice/docs/BITVOICE_RELEASE.json', '/workspace/bitvoice/service-contract.json', '/workspace/bitvoice/bitvoice.lock',
    '/workspace/wscheppity/.local/extraction-manifest.json', '/workspace/wscheppity/.local/vendor-prep/READY.json',
    '/workspace/extra/.local/extraction-manifest.json', '/workspace/extra/.local/extraction-status.json',
    '/workspace/bota/export/coordination-status.json', '/workspace/hy3d/output/content-for-bota.json', '/workspace/hy3d/output/asset-delivery-report.json',
    GM_INSTALLER,
  ];
  return createHash('sha256').update(paths.map((p) => `${p}:${sha(p) || 'missing'}`).join('\n')).digest('hex');
}
if (watch || once) {
  const started = Date.now();
  let previous = currentFingerprint();
  let iterations = 0;
  let report = null;
  for (;;) {
    iterations++;
    const current = currentFingerprint();
    const changed = current !== previous;
    if (once && iterations === 1 && !changed && validExisting(current)) {
      report = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
      console.log(`WORKSPACE_WATCH_ONCE reused valid artifact fingerprint=${current} action=none`);
    } else if (iterations === 1 || changed) report = build();
    previous = current;
    if (once || Date.now() - started >= DURATION_MS) break;
    const sleep = Math.min(INTERVAL_MS, Math.max(0, DURATION_MS - (Date.now() - started)));
    if (sleep > 0) spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${sleep})`], { timeout: sleep + 1000 });
  }
  console.log(`WORKSPACE_WATCH_RESULT once=${once} iterations=${iterations} interval_ms=${INTERVAL_MS} duration_ms=${DURATION_MS} ok=${report?.ok} action=report-only`);
  if (!report?.ok) process.exit(1);
} else {
  const report = build();
  if (!report.ok) process.exit(1);
}
