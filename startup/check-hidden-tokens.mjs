#!/usr/bin/env node
// Deterministic hidden-token/signed-URL scan. Excludes checker regex literals
// and generated artifacts; scans real source, config, docs, and fixtures.
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pattern = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|X-Amz-(Algorithm|Credential|Signature)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/i;
const excludedPath = /check-|validate-|ROLLOUT_REPORT|RELEASE_READINESS|SIMULATED_STARTUP|live-post-restart-probe|simulate-container-startup/;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === '.git' || entry.name === 'node_modules') return [];
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const hits = [];
for (const path of walk(ROOT)) {
  if (!/\.(js|mjs|sh|json|yaml|yml|md|html|txt|log)$/.test(path) || excludedPath.test(path)) continue;
  try {
    const text = readFileSync(path, 'utf8');
    text.split('\n').forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${path}:${index + 1}`);
    });
  } catch {}
}
if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('no hidden-token matches');
