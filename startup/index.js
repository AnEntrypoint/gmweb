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
    // Load configuration
    const configPath = join(__dirname, 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    // Create supervisor
    const supervisor = new Supervisor(config);

    // Dynamic service loader
    const serviceDir = join(__dirname, 'services');
    const serviceNames = [
      'kasmproxy',
      'proxypilot',
      'gemini-cli',
      'wrangler',
      'gcloud',
      'scrot',
      'chromium-ext',
      'claude-cli',
      'claude-marketplace',
      'claude-plugin-gm',
      'webssh2',
      'file-manager',
      'claude-code-ui',
      'sshd',
      'tmux',
      'opencode'
    ];

    console.log('[startup] Loading services...');

    for (const name of serviceNames) {
      try {
        const module = await import(`./services/${name}.js`);
        const service = module.default;

        // Inject config for this service
        service.enabled = config.services[name]?.enabled ?? true;

        supervisor.register(service);
        console.log(`[startup] Registered: ${name}`);
      } catch (err) {
        console.error(`[startup] Failed to load service ${name}:`, err.message);
      }
    }

    console.log('[startup] All services loaded');

    // Start supervisor - this runs forever
    await supervisor.start();

    // If we get here, supervisor has stopped
    console.log('[startup] Supervisor stopped');
    process.exit(0);
  } catch (err) {
    console.error('[startup] FATAL:', err);
    // Try to recover
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
