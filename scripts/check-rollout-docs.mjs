#!/usr/bin/env node
// Tiny deterministic validator for docs/CONTAINER-ROLLOUT.md.
import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const failures = [];
function ok(name, condition, detail = '') {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}
const doc = readFileSync(join(ROOT, 'docs/CONTAINER-ROLLOUT.md'), 'utf8');
const paths = [
  'Dockerfile', 'Dockerfile.headless', 'docker-compose.yaml', 'docker-compose.headless.yaml',
  'docker/99-gmweb-startup.sh', 'docker/custom_startup.sh', 'docker/rest-of-startup.sh',
  'docker/background-installs.sh', 'docker/install-gm.sh', 'startup/start.sh',
  'startup/index.js', 'startup/config.json', 'startup/services/agentgui.js',
  'startup/services/gm-install.js', 'startup/check-container-startup-path.mjs',
  'startup/check-runtime-install.mjs',
];
for (const p of paths) ok(`docs path exists: ${p}`, existsSync(join(ROOT, p)) && doc.includes(p));
ok('docs names exact repository', doc.includes('AnEntrypoint/gmweb'));
ok('docs names default STARTUP_REF', doc.includes('STARTUP_REF') && doc.includes('main'));
ok('docs gives production restart command', doc.includes('docker compose restart gmweb'));
ok('docs gives headless restart command', doc.includes('docker compose -f docker-compose.headless.yaml restart gmweb-headless'));
ok('docs gives post-restart active-spec grep', doc.includes('grep -n "github:AnEntrypoint/agentgui#main" /opt/gmweb-startup/services/agentgui.js'));
ok('docs gives log verification commands', doc.includes('/config/logs/rest-of-startup.log') && doc.includes('/config/logs/gm-install.log'));
ok('docs gives rollback note', /## Rollback/.test(doc) && /restart/.test(doc));
const parityCommand = 'sha256sum docker/install-gm.sh /workspace/gm/scripts/install.sh';
ok('docs states sha parity command', doc.includes(parityCommand));
const local = createHash('sha256').update(readFileSync(join(ROOT, 'docker/install-gm.sh'))).digest('hex');
const canonical = createHash('sha256').update(readFileSync('/workspace/gm/scripts/install.sh')).digest('hex');
ok('stated sha parity command resolves to equal hashes', local === canonical, `${local} vs ${canonical}`);
ok('docs includes container-path gate command', doc.includes('node startup/check-container-startup-path.mjs'));
ok('docs includes this docs gate command', doc.includes('node scripts/check-rollout-docs.mjs'));
for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
console.log(`\n${checks.length - failures.length}/${checks.length} rollout-docs checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
