// Glootie-Kilo Plugin Service
// Installs glootie-kilo plugin for Kilo CLI from AnEntrypoint/glootie-kilo
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { ensureServiceEnvironment } from '../lib/service-utils.js';

const sleep = promisify(setTimeout);

export default {
  name: 'glootie-kilo',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['kilo-cli'],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const kiloConfigDir = `${homeDir}/.config/kilo`;
    const pluginDir = `${kiloConfigDir}/plugin`;
    const repoUrl = 'https://github.com/AnEntrypoint/glootie-kilo.git';

    console.log('[glootie-kilo] Installing glootie-kilo plugin...');

    // Ensure environment is set up
    ensureServiceEnvironment(homeDir, 'glootie-kilo', [
      kiloConfigDir,
      pluginDir
    ]);

    // Clone or update the plugin
    await this.installPlugin(repoUrl, pluginDir, env);

    // Configure Kilo to use the plugin
    this.configureKiloPlugin(homeDir, pluginDir);

    // Fix permissions
    try {
      const { execSync } = await import('child_process');
      execSync(`sudo chown -R abc:abc "${pluginDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${kiloConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log('[glootie-kilo] ✓ Plugin installation complete');

    return {
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    };
  },

  async installPlugin(repoUrl, pluginDir, env) {
    const { execSync } = await import('child_process');

    if (existsSync(pluginDir)) {
      console.log('[glootie-kilo] Plugin exists, updating...');
      try {
        // Fix permissions and pull updates
        execSync(`sudo chown -R abc:abc "${pluginDir}" 2>/dev/null || true`);
        execSync(`sudo -u abc git config --global --add safe.directory "${pluginDir}" 2>/dev/null || true`);
        execSync(`cd "${pluginDir}" && timeout 30 git pull origin main 2>/dev/null || true`, {
          timeout: 30000,
          stdio: 'pipe'
        });
        console.log('[glootie-kilo] ✓ Plugin updated');
      } catch (e) {
        console.log(`[glootie-kilo] Warning: Could not update plugin: ${e.message}`);
      }
    } else {
      console.log('[glootie-kilo] Cloning plugin repository...');
      try {
        execSync(`git clone --depth 1 "${repoUrl}" "${pluginDir}"`, {
          timeout: 60000,
          stdio: 'pipe'
        });
        execSync(`sudo chown -R abc:abc "${pluginDir}" 2>/dev/null || true`);
        console.log('[glootie-kilo] ✓ Plugin cloned');
      } catch (e) {
        console.log(`[glootie-kilo] Error: Could not clone plugin: ${e.message}`);
        return;
      }
    }

    // Run bun install in plugin directory
    if (existsSync(join(pluginDir, 'package.json'))) {
      console.log('[glootie-kilo] Installing plugin dependencies...');
      try {
        execSync(`cd "${pluginDir}" && bun install 2>&1 || npm install 2>&1`, {
          timeout: 120000,
          stdio: 'pipe'
        });
        console.log('[glootie-kilo] ✓ Dependencies installed');
      } catch (e) {
        console.log(`[glootie-kilo] Warning: Could not install dependencies: ${e.message}`);
      }
    }
  },

  configureKiloPlugin(homeDir, pluginDir) {
    console.log('[glootie-kilo] Configuring Kilo to use plugin...');

    const kiloConfigDir = `${homeDir}/.config/kilo`;
    const kiloCodeJsonPath = join(kiloConfigDir, 'kilocode.json');

    // Default config with plugin reference
    let config = {
      "$schema": "https://kilo.ai/config.json",
      "model": "z-ai/glm-5-free",
      "default_agent": "gm",
      "permission": "allow",
      "autoApprove": true,
      "autoApproveAll": true,
      "alwaysAllowReadOnly": true,
      "alwaysAllowWrite": true,
      "alwaysAllowExecute": true,
      "plugin": [pluginDir]
    };

    // Merge with existing config
    if (existsSync(kiloCodeJsonPath)) {
      try {
        const existing = JSON.parse(readFileSync(kiloCodeJsonPath, 'utf8'));
        config = { ...config, ...existing };
        // Ensure model and plugin are set correctly
        config.model = "z-ai/glm-5-free";
        if (!config.plugin) {
          config.plugin = [pluginDir];
        } else if (Array.isArray(config.plugin)) {
          if (!config.plugin.includes(pluginDir)) {
            config.plugin.push(pluginDir);
          }
        } else {
          config.plugin = [config.plugin, pluginDir];
        }
      } catch (e) {
        console.log('[glootie-kilo] Could not parse existing config, using defaults');
      }
    }

    writeFileSync(kiloCodeJsonPath, JSON.stringify(config, null, 2));
    console.log('[glootie-kilo] ✓ Kilo configured with plugin');
  },

  async health() {
    return true;
  }
};
