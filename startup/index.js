#!/usr/bin/env node

// gmweb Startup Supervisor - Immortal orchestrator
// Entry point: Loads all services and starts the supervisor
// Usage: node index.js
// Runs indefinitely - never crashes, always recovers

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Supervisor } from './lib/supervisor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  try {
    console.log('[startup] === SUPERVISOR STARTING ===');
    console.log('[startup] PID:', process.pid);
    console.log('[startup] CWD:', process.cwd());
    console.log('[startup] Node:', process.version);

    // Load configuration
    const configPath = join(__dirname, 'config.json');
    console.log('[startup] Loading config from:', configPath);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    console.log('[startup] Config loaded successfully');

    // Create supervisor
    const supervisor = new Supervisor(config);

    // Dynamic service loader
    const serviceDir = join(__dirname, 'services');
      const serviceNames = [
        'wrangler',
        'gcloud',
        'scrot',
        'chromium-ext',
        'claude-marketplace',
        'claude-plugin-gm',
        'webssh2',
        'file-manager',
        'sshd',
        'tmux',
        'opencode',
        'opencode-web',
        'playwriter',
        'glootie-oc'
      ];

    console.log('[startup] Loading services...');
    let loadedCount = 0;
    let skippedCount = 0;

    for (const name of serviceNames) {
      try {
        const serviceConfig = config.services[name];
        const isEnabled = serviceConfig?.enabled !== false;

        if (!isEnabled) {
          console.log(`[startup] Skipping disabled service: ${name}`);
          skippedCount++;
          continue;
        }

        console.log(`[startup] Loading service: ${name}...`);
        const module = await import(`./services/${name}.js`);
        const service = module.default;

        // Inject config for this service
        service.enabled = true;

        supervisor.register(service);
        console.log(`[startup] ✓ Registered: ${name}`);
        loadedCount++;
      } catch (err) {
        console.error(`[startup] ✗ Failed to load service ${name}:`, err.message);
      }
    }

    console.log(`[startup] Service loading complete: ${loadedCount} loaded, ${skippedCount} skipped`);

    // Start supervisor - this runs forever
    console.log('[startup] Starting supervisor...');
    await supervisor.start();

    // If we get here, supervisor has stopped
    console.log('[startup] Supervisor stopped (unexpected)');
    process.exit(0);
  } catch (err) {
    console.error('[startup] FATAL:', err.message);
    console.error('[startup] Stack:', err.stack);
    // Try to recover
    console.log('[startup] Retrying in 5 seconds...');
    setTimeout(main, 5000);
  }
}

// Global error handlers - prevent any crash
process.on('uncaughtException', (err) => {
  console.error('[startup] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[startup] Unhandled rejection:', reason);
});

// Start the supervisor
main().catch((err) => {
  console.error('[startup] Startup error:', err);
  setTimeout(main, 5000);
});
