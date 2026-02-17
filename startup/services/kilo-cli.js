// Kilo CLI Service
// Installs the @kilocode/cli package globally and configures GLM-5 as default model
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ensureServiceEnvironment } from '../lib/service-utils.js';

const NAME = 'kilo';
const PKG = '@kilocode/cli';
const KILO_CONFIG_DIR = '/config/.config/kilo';

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const binPath = `${dirname(process.execPath)}/${NAME}`;

    console.log(`[${NAME}] Installing ${PKG}...`);

    // Ensure directories exist
    ensureServiceEnvironment(homeDir, NAME, [
      KILO_CONFIG_DIR,
      `${homeDir}/.local/share/kilo`,
    ]);

    // Install Kilo CLI globally using bun (faster) with npm fallback
    try {
      const bunPath = env.BUN_INSTALL ? `${env.BUN_INSTALL}/bin/bun` : 'bun';
      execSync(`${bunPath} install -g ${PKG} 2>&1 || npm install -g ${PKG} 2>&1`, {
        stdio: 'pipe',
        timeout: 120000,
        env: { ...process.env, ...env, HOME: '/config' }
      });
      console.log(`[${NAME}] ✓ Installed ${PKG}`);
    } catch (e) {
      console.log(`[${NAME}] Warning: install failed: ${e.message}`);
    }

    // Create wrapper if binary doesn't exist (uses bunx for consistency)
    if (!existsSync(binPath)) {
      const bunPath = env.BUN_INSTALL ? `${env.BUN_INSTALL}/bin` : dirname(process.execPath);
      const wrapperContent = `#!/bin/bash\nexec ${bunPath}/bunx ${PKG} "$@"\n`;
      writeFileSync(binPath, wrapperContent);
      execSync(`chmod +x "${binPath}"`, { stdio: 'pipe' });
      console.log(`[${NAME}] ✓ Wrapper created`);
    }

    // Set up initial Kilo configuration with GLM-5 as default model
    this.configureKilo(homeDir);

    // Fix permissions
    try {
      execSync(`sudo chown -R abc:abc "${KILO_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${KILO_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log(`[${NAME}] Kilo CLI installation complete`);

    return {
      pid: 0,
      process: null,
      cleanup: async () => {}
    };
  },

  configureKilo(homeDir) {
    console.log('[kilo-cli] Configuring Kilo with GLM-5 default model...');

    // Ensure config directory exists
    if (!existsSync(KILO_CONFIG_DIR)) {
      mkdirSync(KILO_CONFIG_DIR, { recursive: true });
    }

    const kiloCodeJsonPath = join(KILO_CONFIG_DIR, 'kilocode.json');
    const opencodeJsonPath = join(KILO_CONFIG_DIR, 'opencode.json');

    // Default Kilo config with GLM-5
    const defaultKiloConfig = {
      "$schema": "https://kilo.ai/config.json",
      "model": "z-ai/glm-5-free",
      "default_agent": "gm",
      "permission": "allow",
      "autoApprove": true,
      "autoApproveAll": true,
      "alwaysAllowReadOnly": true,
      "alwaysAllowWrite": true,
      "alwaysAllowExecute": true
    };

    // Default opencode.json for MCP servers
    const defaultOpencodeConfig = {
      "$schema": "https://opencode.ai/config.json",
      "mcp": {
        "dev": {
          "type": "local",
          "command": ["bunx", "mcp-glootie@latest"],
          "timeout": 360000,
          "enabled": true
        },
        "code-search": {
          "type": "local",
          "command": ["bunx", "codebasesearch@latest"],
          "timeout": 360000,
          "enabled": true
        }
      }
    };

    // Merge with existing config if present
    let kiloConfig = defaultKiloConfig;
    if (existsSync(kiloCodeJsonPath)) {
      try {
        const existing = JSON.parse(readFileSync(kiloCodeJsonPath, 'utf8'));
        kiloConfig = { ...defaultKiloConfig, ...existing };
        // Ensure model is set to GLM-5 free
        kiloConfig.model = "z-ai/glm-5-free";
      } catch (e) {
        console.log('[kilo-cli] Could not parse existing kilocode.json, using defaults');
      }
    }

    let opencodeConfig = defaultOpencodeConfig;
    if (existsSync(opencodeJsonPath)) {
      try {
        const existing = JSON.parse(readFileSync(opencodeJsonPath, 'utf8'));
        opencodeConfig = { ...defaultOpencodeConfig, ...existing };
      } catch (e) {
        console.log('[kilo-cli] Could not parse existing opencode.json, using defaults');
      }
    }

    writeFileSync(kiloCodeJsonPath, JSON.stringify(kiloConfig, null, 2));
    writeFileSync(opencodeJsonPath, JSON.stringify(opencodeConfig, null, 2));

    console.log('[kilo-cli] ✓ Kilo configured with GLM-5 free as default model');
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
