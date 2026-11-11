#!/usr/bin/env node
// Detect drift between /workspace/gm/scripts/install.sh and gmweb's vendored
// installer. Read-only against /workspace/gm; prints a precise update action.
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// --watch --once is accepted as an explicit one-shot alias for the bounded watcher.
if (process.argv.includes('--watch') && process.argv.includes('--once')) {
  const r = spawnSync(process.execPath, [join(ROOT, 'startup', 'watch-gm-drift.mjs'), '--once'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  process.exit(Number(r.status ?? 1));
}
const GM_SOURCE = process.env.GM_SOURCE || '/workspace/gm/scripts/install.sh';
const VENDORED = join(ROOT, 'docker/install-gm.sh');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function behavioralSignature(text) {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('#!'))
    .filter((line) => !line.startsWith('RELEASE_BASE='))
    .filter((line) => !line.includes('https://raw.githubusercontent.com'))
    .join('\n');
}
function sectionFor(lineNumber, sourceLines) {
  let section = 'top-level';
  for (let i = 0; i < Math.min(lineNumber, sourceLines.length); i++) {
    const line = sourceLines[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/.test(line.trim())) section = line.trim().replace(/\s*\{$/, '()');
    else if (/^case\s+/.test(line.trim())) section = `case ${line.trim().split(/\s+/)[1]}`;
  }
  return section;
}

ok('canonical gm installer exists', existsSync(GM_SOURCE), GM_SOURCE);
ok('gmweb vendored installer exists', existsSync(VENDORED), VENDORED);
if (!existsSync(GM_SOURCE) || !existsSync(VENDORED)) {
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  console.error('GM_DRIFT: cannot compare missing installer');
  process.exit(1);
}
const upstreamBuf = readFileSync(GM_SOURCE);
const vendoredBuf = readFileSync(VENDORED);
const upstream = upstreamBuf.toString('utf8');
const vendored = vendoredBuf.toString('utf8');
const upstreamHash = sha(upstreamBuf);
const vendoredHash = sha(vendoredBuf);
const upstreamSig = behavioralSignature(upstream);
const vendoredSig = behavioralSignature(vendored);

const git = spawnSync('git', ['-C', '/workspace/gm', 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const gmHead = git.status === 0 ? git.stdout.trim() : 'UNAVAILABLE';
const gitStatus = spawnSync('git', ['-C', '/workspace/gm', 'status', '--short'], { encoding: 'utf8' });
const dirty = gitStatus.status === 0 && gitStatus.stdout.trim().length > 0;

console.log(`GM_SOURCE=${GM_SOURCE}`);
console.log(`GM_HEAD=${gmHead}${dirty ? ' (worktree has local changes)' : ''}`);
console.log(`UPSTREAM_SHA256=${upstreamHash}`);
console.log(`VENDORED_SHA256=${vendoredHash}`);

ok('installer bytes match canonical gm installer', upstreamHash === vendoredHash, `${upstreamHash} vs ${vendoredHash}`);
ok('installer behavioral signatures match', upstreamSig === vendoredSig);
ok('canonical installer still contains release manifest verification', upstream.includes('$RELEASE_BASE/manifest.json') && upstream.includes('EXPECTED_SHA') && upstream.includes('EXPECTED_SIZE'));
ok('canonical installer still contains native registration', upstream.includes('"$EXE" install --mcp-config "$MCP_CONFIG"') && upstream.includes('GMNEW_SKIP_REGISTER'));
ok('static validator uses same canonical source', readFileSync(join(ROOT, 'startup/check-startup-sources.mjs'), 'utf8').includes('GM_SOURCE'));
ok('runtime validator compares canonical installer', readFileSync(join(ROOT, 'startup/check-runtime-install.mjs'), 'utf8').includes('/workspace/gm/scripts/install.sh'));
ok('container-path validator checks fetched installer copy', readFileSync(join(ROOT, 'startup/check-container-startup-path.mjs'), 'utf8').includes('docker/install-gm.sh'));

for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} gm-drift checks passed`);
if (failures.length) {
  const a = upstream.split('\n');
  const b = vendored.split('\n');
  let first = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { first = i; break; }
  }
  if (first >= 0) {
    const section = sectionFor(first, a);
    console.error(`GM_DRIFT section=${section} upstream_line=${first + 1}`);
    console.error(`  upstream: ${JSON.stringify(a[first] ?? '<EOF>')}`);
    console.error(`  vendored: ${JSON.stringify(b[first] ?? '<EOF>')}`);
  }
  console.error(`UPDATE_ACTION: cp ${GM_SOURCE} ${VENDORED}; then run npm run check, npm --prefix startup run check, node startup/check-container-startup-path.mjs, node startup/check-runtime-install.mjs, and sha256sum docker/install-gm.sh ${GM_SOURCE}`);
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`GM_DRIFT_OK head=${gmHead} sha256=${upstreamHash}`);
