// Gemini CLI Service
// Installs @google/gemini-cli and enables preview features for Gemini 3 access
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { createNpxWrapper, precacheNpmPackage, ensureServiceEnvironment } from '../lib/service-utils.js';

const NAME = 'gemini';
const PKG = '@google/gemini-cli';
const GEMINI_CONFIG_DIR = '/config/.gemini';

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const binPath = `${dirname(process.execPath)}/${NAME}`;

    console.log(`[${NAME}] Installing ${PKG}...`);

    ensureServiceEnvironment(homeDir, NAME, [
      GEMINI_CONFIG_DIR,
      `${homeDir}/.config/gemini`
    ]);

    if (!existsSync(binPath)) {
      if (!createNpxWrapper(binPath, PKG)) {
        console.log(`[${NAME}] ✗ Failed to create wrapper`);
        return { pid: 0, process: null, cleanup: async () => {} };
      }
      console.log(`[${NAME}] ✓ Wrapper created`);
    }

    precacheNpmPackage(PKG, env);

    this.configureGemini(homeDir);

    try {
      execSync(`sudo chown -R abc:abc "${GEMINI_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${GEMINI_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log(`[${NAME}] ✓ Gemini CLI installed with preview features enabled for Gemini 3`);

    return { pid: 0, process: null, cleanup: async () => {} };
  },

  configureGemini(homeDir) {
    console.log('[gemini-cli] Enabling preview features for Gemini 3...');

    if (!existsSync(GEMINI_CONFIG_DIR)) {
      mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    }

    const settingsPath = join(GEMINI_CONFIG_DIR, 'settings.json');
    
    let settings = {
      "enablePreviewFeatures": true,
      "extensions": {}
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
      } catch (e) {
        console.log('[gemini-cli] Could not parse existing settings, using defaults');
      }
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('[gemini-cli] ✓ Preview features enabled - Gemini 3 models now accessible');
  },

  async health() {
    try {
      const binPath = `${dirname(process.execPath)}/${NAME}`;
      return existsSync(binPath);
    } catch (e) {
      return false;
    }
  }
};

