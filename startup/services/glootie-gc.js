// Glootie-GC Gemini CLI Plugin Service
// Installs glootie-gc plugin for Gemini CLI from AnEntrypoint/glootie-gc
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { ensureServiceEnvironment } from '../lib/service-utils.js';

const sleep = promisify(setTimeout);

export default {
  name: 'glootie-gc',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['gemini-cli'],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const geminiConfigDir = `${homeDir}/.gemini`;
    const extensionDir = `${geminiConfigDir}/extensions/gm`;
    const repoUrl = 'https://github.com/AnEntrypoint/glootie-gc.git';

    console.log('[glootie-gc] Installing glootie-gc plugin for Gemini CLI...');

    ensureServiceEnvironment(homeDir, 'glootie-gc', [
      geminiConfigDir,
      `${geminiConfigDir}/extensions`
    ]);

    await this.installPlugin(repoUrl, extensionDir, env);

    this.configureGeminiPlugin(homeDir, extensionDir);

    this.enablePreviewFeatures(homeDir);

    try {
      const { execSync } = await import('child_process');
      execSync(`sudo chown -R abc:abc "${extensionDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${geminiConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log('[glootie-gc] ✓ Plugin installation complete');

    return {
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    };
  },

  async installPlugin(repoUrl, extensionDir, env) {
    const { execSync } = await import('child_process');

    if (existsSync(extensionDir)) {
      console.log('[glootie-gc] Plugin exists, updating...');
      try {
        execSync(`sudo chown -R abc:abc "${extensionDir}" 2>/dev/null || true`);
        execSync(`sudo -u abc git config --global --add safe.directory "${extensionDir}" 2>/dev/null || true`);
        execSync(`cd "${extensionDir}" && timeout 30 git pull origin main 2>/dev/null || true`, {
          timeout: 30000,
          stdio: 'pipe'
        });
        console.log('[glootie-gc] ✓ Plugin updated');
      } catch (e) {
        console.log(`[glootie-gc] Warning: Could not update plugin: ${e.message}`);
      }
    } else {
      console.log('[glootie-gc] Cloning plugin repository...');
      try {
        execSync(`git clone --depth 1 "${repoUrl}" "${extensionDir}"`, {
          timeout: 60000,
          stdio: 'pipe'
        });
        execSync(`sudo chown -R abc:abc "${extensionDir}" 2>/dev/null || true`);
        console.log('[glootie-gc] ✓ Plugin cloned');
      } catch (e) {
        console.log(`[glootie-gc] Error: Could not clone plugin: ${e.message}`);
        return;
      }
    }

    if (existsSync(join(extensionDir, 'package.json'))) {
      console.log('[glootie-gc] Installing plugin dependencies...');
      try {
        execSync(`cd "${extensionDir}" && bun install 2>&1 || npm install 2>&1`, {
          timeout: 120000,
          stdio: 'pipe'
        });
        console.log('[glootie-gc] ✓ Dependencies installed');
      } catch (e) {
        console.log(`[glootie-gc] Warning: Could not install dependencies: ${e.message}`);
      }
    }
  },

  configureGeminiPlugin(homeDir, extensionDir) {
    console.log('[glootie-gc] Configuring Gemini CLI to use plugin...');

    const geminiConfigDir = `${homeDir}/.gemini`;
    const settingsPath = join(geminiConfigDir, 'settings.json');

    let settings = {
      "enablePreviewFeatures": true,
      "extensions": { "gm": true }
    };

    if (existsSync(settingsPath)) {
      try {
        const existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
        settings = { ...settings, ...existing };
        settings.enablePreviewFeatures = true;
        if (Array.isArray(settings.extensions)) {
          const extObj = {};
          settings.extensions.forEach(ext => { extObj[ext] = true; });
          settings.extensions = extObj;
        }
        if (!settings.extensions || typeof settings.extensions !== 'object') {
          settings.extensions = {};
        }
        settings.extensions.gm = true;
      } catch (e) {
        console.log('[glootie-gc] Could not parse existing settings, using defaults');
      }
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('[glootie-gc] ✓ Gemini CLI configured with preview features enabled');
  },

  enablePreviewFeatures(homeDir) {
    console.log('[glootie-gc] Enabling Gemini CLI preview features for Gemini 3 access...');

    const geminiConfigDir = `${homeDir}/.gemini`;
    const gcpConfigDir = `${homeDir}/.config/gcloud`;

    try {
      if (!existsSync(geminiConfigDir)) {
        mkdirSync(geminiConfigDir, { recursive: true });
      }

      const settingsPath = join(geminiConfigDir, 'settings.json');
      let settings = {};

      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        } catch (e) {}
      }

      settings.enablePreviewFeatures = true;

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('[glootie-gc] ✓ Preview features enabled for Gemini 3 access');
    } catch (e) {
      console.log(`[glootie-gc] Warning: Could not enable preview features: ${e.message}`);
    }
  },

  async health() {
    return true;
  }
};
