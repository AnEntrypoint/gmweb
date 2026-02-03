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
const GLOOTIE_DIR = join(OPENCODE_CONFIG_DIR, 'glootie-oc');

// OpenCode settings that allow everything without prompting
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
  "apiProvider": "anthropic",
  "model": "claude-sonnet-4",
  "workspaceRoot": "/config/workspace",
  "defaultAgent": "gm"
};

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function installGlootieOc() {
  console.log('[opencode-config] Installing glootie-oc extension...');

  try {
    if (existsSync(GLOOTIE_DIR)) {
      console.log('[opencode-config] glootie-oc exists, pulling updates...');
      try {
        execSync(`cd "${GLOOTIE_DIR}" && git pull origin main 2>/dev/null || true`, {
          timeout: 30000,
          stdio: 'pipe'
        });
      } catch (e) {
        // Pull failed, try fresh clone
        console.log('[opencode-config] Pull failed, re-cloning...');
        execSync(`rm -rf "${GLOOTIE_DIR}"`, { stdio: 'pipe' });
        execSync(`git clone --depth 1 "${GLOOTIE_REPO}" "${GLOOTIE_DIR}"`, {
          timeout: 60000,
          stdio: 'pipe'
        });
      }
    } else {
      console.log('[opencode-config] Cloning glootie-oc...');
      execSync(`git clone --depth 1 "${GLOOTIE_REPO}" "${GLOOTIE_DIR}"`, {
        timeout: 60000,
        stdio: 'pipe'
      });
    }

    console.log('[opencode-config] ✓ glootie-oc installed');
  } catch (e) {
    console.log(`[opencode-config] Warning: Could not install glootie-oc: ${e.message}`);
  }
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
  console.log('[opencode-config] Setting up glootie-oc configuration...');

  try {
    const glootieConfigSrc = join(GLOOTIE_DIR, 'opencode.json');
    const opencodeConfigDest = join(OPENCODE_CONFIG_DIR, 'opencode.json');

    // Start with existing config or empty object
    let existingConfig = {};
    if (existsSync(opencodeConfigDest)) {
      try {
        existingConfig = JSON.parse(readFileSync(opencodeConfigDest, 'utf8'));
      } catch (e) {}
    }

    // Merge glootie-oc's opencode.json if available
    let glootieConfig = {};
    if (existsSync(glootieConfigSrc)) {
      try {
        glootieConfig = JSON.parse(readFileSync(glootieConfigSrc, 'utf8'));
      } catch (e) {}
    }

    // Build final config: schema + permission + glootie settings
    const mergedConfig = {
      "$schema": "https://opencode.ai/config.json",
      "permission": "allow",
      ...existingConfig,
      // Ensure permission is always allow (override any stale value)
      ...{ permission: "allow" },
      // Merge glootie-oc settings
      ...(glootieConfig.default_agent ? { default_agent: glootieConfig.default_agent } : {}),
      ...(glootieConfig.plugin ? { plugin: glootieConfig.plugin } : {}),
      mcp: {
        ...(existingConfig.mcp || {}),
        ...(glootieConfig.mcp || {})
      }
    };

    writeFileSync(opencodeConfigDest, JSON.stringify(mergedConfig, null, 2));
    console.log('[opencode-config] ✓ opencode.json configured with permission:allow + glootie-oc');

    // Copy agents from glootie-oc
    const agentsSrcDir = join(GLOOTIE_DIR, 'agents');
    const agentsDestDir = join(OPENCODE_CONFIG_DIR, 'agents');

    if (existsSync(agentsSrcDir)) {
      ensureDir(agentsDestDir);
      execSync(`cp -r "${agentsSrcDir}"/* "${agentsDestDir}/" 2>/dev/null || true`, {
        stdio: 'pipe'
      });
      console.log('[opencode-config] ✓ glootie agents copied');
    }

    // Copy hooks from glootie-oc
    const hooksSrcDir = join(GLOOTIE_DIR, 'hooks');
    const hooksDestDir = join(OPENCODE_CONFIG_DIR, 'hooks');

    if (existsSync(hooksSrcDir)) {
      ensureDir(hooksDestDir);
      execSync(`cp -r "${hooksSrcDir}"/* "${hooksDestDir}/" 2>/dev/null || true`, {
        stdio: 'pipe'
      });
      console.log('[opencode-config] ✓ glootie hooks copied');
    }
  } catch (e) {
    console.log(`[opencode-config] Warning: Could not setup glootie config: ${e.message}`);
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

    // Set ownership
    try {
      execSync(`chown -R abc:abc "${OPENCODE_CONFIG_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`chown -R abc:abc "${OPENCODE_STORAGE_DIR}" 2>/dev/null || true`, { stdio: 'pipe' });
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
