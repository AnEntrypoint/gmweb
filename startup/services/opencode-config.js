// OpenCode Configuration Service
// Sets up glootie-oc extension and configures permissive settings
// Runs on every boot - must handle stale /config volume from previous boots
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { ensureServiceEnvironment } from '../lib/service-utils.js';

const OPENCODE_CONFIG_DIR = '/config/.config/opencode';
const OPENCODE_STORAGE_DIR = '/config/.local/share/opencode/storage';
const GLOOTIE_REPO = 'https://github.com/AnEntrypoint/glootie-oc.git';
const GLOOTIE_DIR = join(OPENCODE_CONFIG_DIR, 'plugin');

// OpenCode settings that allow everything without prompting
// Default model is Kimi K2.5 (free tier) - set preview features for Gemini 3 access
const PERMISSIVE_SETTINGS = {
  "autoApprove": true,
  "autoApproveAll": true,
  "alwaysAllowReadOnly": true,
  "alwaysAllowWrite": true,
  "alwaysAllowExecute": true,
  "toolPermissions": {
    "bash": "always",
    "computer": "always",
    "text_editor": "always",
    "read": "always",
    "write": "always",
    "glob": "always",
    "grep": "always",
    "list_dir": "always",
    "mcp": "always"
  },
  "apiProvider": "kimi-for-coding",
  "model": "kimi-for-coding/k2.5",
  "workspaceRoot": "/config/workspace",
  "defaultAgent": "gm"
};

// Kimi K2.5 provider configuration (free tier compatible)
const KIMI_PROVIDER_CONFIG = {
  "kimi-for-coding": {
    "name": "Kimi For Coding",
    "npm": "@ai-sdk/anthropic",
    "options": {
      "baseURL": "https://api.kimi.com/coding/v1"
    },
    "models": {
      "k2.5": {
        "name": "Kimi K2.5",
        "reasoning": true,
        "attachment": true,
        "limit": {
          "context": 262144,
          "output": 32768
        },
        "modalities": {
          "input": ["text", "image", "video"],
          "output": ["text"]
        },
        "options": {
          "interleaved": {
            "field": "reasoning_content"
          }
        }
      }
    }
  }
};

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function installGlootieOc() {
  console.log('[opencode-config] Plugin directory preparation (glootie-oc service handles clone)...');
}

function configureOpenCode() {
  console.log('[opencode-config] Configuring OpenCode settings...');

  const settingsFile = join(OPENCODE_CONFIG_DIR, 'settings.json');

  let existingSettings = {};
  if (existsSync(settingsFile)) {
    try {
      existingSettings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    } catch (e) {
      console.log('[opencode-config] Could not parse existing settings, using defaults');
    }
  }

  const mergedSettings = {
    ...existingSettings,
    ...PERMISSIVE_SETTINGS,
    toolPermissions: {
      ...(existingSettings.toolPermissions || {}),
      ...PERMISSIVE_SETTINGS.toolPermissions
    }
  };

  writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));
  console.log('[opencode-config] ✓ settings.json configured');
}

function setupGlootieConfig() {
  console.log('[opencode-config] Setting up opencode configuration with Kimi K2.5...');

  try {
    const opencodeConfigDest = join(OPENCODE_CONFIG_DIR, 'opencode.json');

    let existingConfig = {};
    if (existsSync(opencodeConfigDest)) {
      try {
        existingConfig = JSON.parse(readFileSync(opencodeConfigDest, 'utf8'));
      } catch (e) {}
    }

    let mergedConfig = {
      "$schema": "https://opencode.ai/config.json",
      "permission": "allow",
      "autoApprove": true,
      "autoApproveAll": true,
      "alwaysAllowReadOnly": true,
      "alwaysAllowWrite": true,
      "alwaysAllowExecute": true,
      "model": "kimi-for-coding/k2.5",
      ...existingConfig,
      ...{ permission: "allow" },
      ...{ model: "kimi-for-coding/k2.5" },
      provider: {
        ...(existingConfig.provider || {}),
        ...KIMI_PROVIDER_CONFIG
      }
    };

    if (existsSync(GLOOTIE_DIR)) {
      const glootieConfigSrc = join(GLOOTIE_DIR, 'opencode.json');
      if (existsSync(glootieConfigSrc)) {
        try {
          const glootieConfig = JSON.parse(readFileSync(glootieConfigSrc, 'utf8'));
          mergedConfig = {
            ...mergedConfig,
            ...(glootieConfig.default_agent ? { default_agent: glootieConfig.default_agent } : {}),
            ...(glootieConfig.plugin ? { plugin: glootieConfig.plugin } : {}),
            mcp: {
              ...(mergedConfig.mcp || {}),
              ...(glootieConfig.mcp || {})
            }
          };
        } catch (e) {}
      }

      const agentsSrcDir = join(GLOOTIE_DIR, 'agents');
      const agentsDestDir = join(OPENCODE_CONFIG_DIR, 'agents');
      if (existsSync(agentsSrcDir)) {
        ensureDir(agentsDestDir);
        execSync(`cp -r "${agentsSrcDir}"/* "${agentsDestDir}/" 2>/dev/null || true`, {
          stdio: 'pipe'
        });
        console.log('[opencode-config] ✓ glootie agents copied');
      }

      const hooksSrcDir = join(GLOOTIE_DIR, 'hooks');
      const hooksDestDir = join(OPENCODE_CONFIG_DIR, 'hooks');
      if (existsSync(hooksSrcDir)) {
        ensureDir(hooksDestDir);
        execSync(`cp -r "${hooksSrcDir}"/* "${hooksDestDir}/" 2>/dev/null || true`, {
          stdio: 'pipe'
        });
        console.log('[opencode-config] ✓ glootie hooks copied');
      }
    }

    if (mergedConfig.plugin && Array.isArray(mergedConfig.plugin)) {
      mergedConfig.plugin = mergedConfig.plugin.map(p => p === 'gloutie' ? 'glootie-oc' : p);
    }

    writeFileSync(opencodeConfigDest, JSON.stringify(mergedConfig, null, 2));
    console.log('[opencode-config] ✓ opencode.json configured with Kimi K2.5 default model');

  } catch (e) {
    console.log(`[opencode-config] Warning: Could not setup config: ${e.message}`);
  }
}

export default {
  name: 'opencode-config',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[opencode-config] Configuring OpenCode and installing glootie-oc...');

    // CRITICAL: Ensure service environment is properly set up first
    const homeDir = env.HOME || '/config';
    ensureServiceEnvironment(homeDir, 'opencode-config', [
      OPENCODE_CONFIG_DIR,
      OPENCODE_STORAGE_DIR,
      `${homeDir}/.config/opencode`,
      `${homeDir}/.local/share/opencode`,
      `${homeDir}/.local/share/opencode/storage`
    ]);

    ensureDir(OPENCODE_CONFIG_DIR);
    ensureDir(OPENCODE_STORAGE_DIR);

    // Environment file for OpenCode
    const envFile = join(OPENCODE_CONFIG_DIR, '.env');
    writeFileSync(envFile, `# OpenCode Environment - Auto-configured
OPENCODE_AUTO_APPROVE=true
OPENCODE_ALWAYS_ALLOW_READ=true
OPENCODE_ALWAYS_ALLOW_WRITE=true
OPENCODE_ALWAYS_ALLOW_EXECUTE=true
OPENCODE_DEFAULT_AGENT=gm
OPENCODE_WORKSPACE=/config/workspace
`);

    // Install glootie-oc extension (clone/update from git)
    installGlootieOc();

    // Configure OpenCode with permissive settings
    configureOpenCode();

    // Setup opencode.json with permission:allow + glootie-oc config
    setupGlootieConfig();

    // Set ownership with sudo for robustness
    try {
      execSync(`sudo chown -R abc:abc "${OPENCODE_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${OPENCODE_STORAGE_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${OPENCODE_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${OPENCODE_STORAGE_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log('[opencode-config] ✓ OpenCode configuration complete');

    return {
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    };
  },

  async health() {
    return true;
  }
};
