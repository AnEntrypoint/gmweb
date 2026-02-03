import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { ensureServiceEnvironment } from '../lib/service-utils.js';

const DEFAULT_SETTINGS = {
  model: 'haiku',
  enabledPlugins: {
    'gm@glootie-cc': true,
    'agent-browser@agent-browser': true
  }
};

const DEFAULT_MARKETPLACES = {
  'claude-plugins-official': {
    source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
    installLocation: '/config/.claude/plugins/marketplaces/claude-plugins-official'
  },
  'glootie-cc': {
    source: { source: 'github', repo: 'AnEntrypoint/glootie-cc' },
    installLocation: '/config/.claude/plugins/marketplaces/glootie-cc',
    autoUpdate: true
  },
  'agent-browser': {
    source: { source: 'github', repo: 'vercel-labs/agent-browser' },
    installLocation: '/config/.claude/plugins/marketplaces/agent-browser',
    autoUpdate: true
  }
};

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function mergeSettings(existing, defaults) {
  const merged = { ...defaults };
  if (existing.model) merged.model = existing.model;
  merged.enabledPlugins = { ...defaults.enabledPlugins, ...existing.enabledPlugins };
  return merged;
}

function mergeMarketplaces(existing, defaults) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(existing)) {
    if (merged[key]) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function cloneMarketplace(name, repo, installLocation) {
  if (existsSync(installLocation)) {
    console.log(`[claude-config] Marketplace ${name} exists, pulling updates...`);
    try {
      execSync(`cd "${installLocation}" && git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true`, {
        timeout: 30000,
        stdio: 'pipe'
      });
    } catch (e) {
      console.log(`[claude-config] Warning: Could not update ${name}: ${e.message}`);
    }
  } else {
    console.log(`[claude-config] Cloning marketplace ${name}...`);
    try {
      ensureDir(join(installLocation, '..'));
      execSync(`git clone --depth 1 https://github.com/${repo}.git "${installLocation}"`, {
        timeout: 60000,
        stdio: 'pipe'
      });
    } catch (e) {
      console.log(`[claude-config] Warning: Could not clone ${name}: ${e.message}`);
    }
  }
}

function installClaudeCode() {
  // Install Claude Code via native installer (not npm - npm method is deprecated)
  // Native binary goes to ~/.local/bin/claude with auto-updates
  const claudeBin = join(process.env.HOME || '/config', '.local', 'bin', 'claude');
  try {
    if (!existsSync(claudeBin)) {
      console.log('[claude-config] Installing Claude Code via native installer...');
      execSync('curl -fsSL https://claude.ai/install.sh | bash', {
        stdio: 'pipe',
        timeout: 120000
      });
    }
    if (existsSync(claudeBin)) {
      console.log('[claude-config] ✓ Claude Code installed natively');
    }
  } catch (e) {
    console.log(`[claude-config] Warning: Claude Code native install failed: ${e.message}`);
  }
}

function installClaudeCodeAcp() {
  // Install @zed-industries/claude-code-acp globally via npm install -g
  // This is the ACP bridge that AionUI uses to communicate with Claude Code
  // npm install -g puts it in NPM_CONFIG_PREFIX (/config/.gmweb/npm-global) which is in PATH
  // NEVER use --prefix into the NVM node dir - that nukes npm itself
  try {
    const globalBin = '/config/.gmweb/npm-global/bin/claude-code-acp';
    const globalLib = '/config/.gmweb/npm-global/lib/node_modules/@zed-industries/claude-code-acp/dist/index.js';

    if (!existsSync(globalLib)) {
      console.log('[claude-config] Installing @zed-industries/claude-code-acp globally...');
      execSync('npm install -g @zed-industries/claude-code-acp@latest', {
        stdio: 'pipe',
        timeout: 120000
      });
    }

    if (existsSync(globalBin)) {
      console.log('[claude-config] ✓ claude-code-acp ACP bridge installed');
    } else {
      console.log('[claude-config] Warning: claude-code-acp binary not found after install');
    }
  } catch (e) {
    console.log(`[claude-config] Warning: Could not install claude-code-acp: ${e.message}`);
  }
}

function patchAcpDefaultModel(model) {
  // PATCH: The ACP bridge's getAvailableModels() always picks models[0] (opus) as default.
  // It ignores settings.json model preference. We patch the installed JS to respect it.
  // This runs every boot so it survives npm updates (fresh install → re-patch).
  const acpAgentFile = '/config/.gmweb/npm-global/lib/node_modules/@zed-industries/claude-code-acp/dist/acp-agent.js';
  if (!existsSync(acpAgentFile)) return;

  try {
    let content = readFileSync(acpAgentFile, 'utf8');

    // The original code:
    //   const currentModel = models[0];
    //   await query.setModel(currentModel.value);
    // We replace with: find model matching settings, fall back to first
    const original = 'const currentModel = models[0];\n    await query.setModel(currentModel.value);';
    const patched = `const _preferredModel = "${model}";\n    const currentModel = models.find(m => m.value === _preferredModel) || models[0];\n    await query.setModel(currentModel.value);`;

    if (content.includes(patched)) {
      console.log(`[claude-config] ✓ ACP bridge already patched for model: ${model}`);
      return;
    }

    if (content.includes(original)) {
      content = content.replace(original, patched);
      writeFileSync(acpAgentFile, content);
      console.log(`[claude-config] ✓ ACP bridge patched: default model → ${model}`);
    } else if (content.includes('const _preferredModel =')) {
      // Re-patch with updated model (e.g. haiku → sonnet change)
      content = content.replace(/const _preferredModel = "[^"]*";\n    const currentModel = models\.find\(m => m\.value === _preferredModel\) \|\| models\[0\];\n    await query\.setModel\(currentModel\.value\);/,
        patched);
      writeFileSync(acpAgentFile, content);
      console.log(`[claude-config] ✓ ACP bridge re-patched: default model → ${model}`);
    } else {
      console.log('[claude-config] Warning: ACP bridge code structure changed, cannot patch model default');
    }
  } catch (e) {
    console.log(`[claude-config] Warning: Could not patch ACP bridge: ${e.message}`);
  }
}

export default {
  name: 'claude-config',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const claudeDir = join(env.HOME || '/config', '.claude');
    const pluginsDir = join(claudeDir, 'plugins');
    const marketplacesDir = join(pluginsDir, 'marketplaces');
    const settingsFile = join(claudeDir, 'settings.json');
    const marketplacesFile = join(pluginsDir, 'known_marketplaces.json');

    console.log('[claude-config] Ensuring Claude Code configuration...');

    // CRITICAL: Ensure service environment is properly set up first
    const homeDir = env.HOME || '/config';
    ensureServiceEnvironment(homeDir, 'claude-config', [
      claudeDir,
      pluginsDir,
      marketplacesDir,
      `${homeDir}/.local/bin`
    ]);

    // Install Claude Code native binary (curl installer, auto-updates)
    installClaudeCode();

    // Install ACP bridge for AionUI (npm install -g → /config/.gmweb/npm-global/)
    installClaudeCodeAcp();

    ensureDir(claudeDir);
    ensureDir(pluginsDir);
    ensureDir(marketplacesDir);

    let existingSettings = {};
    if (existsSync(settingsFile)) {
      try {
        existingSettings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      } catch (e) {
        console.log('[claude-config] Could not parse existing settings, using defaults');
      }
    }

    const mergedSettings = mergeSettings(existingSettings, DEFAULT_SETTINGS);
    writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));
    console.log('[claude-config] ✓ Settings configured:', Object.keys(mergedSettings.enabledPlugins).join(', '));

    // Patch ACP bridge to use the configured model as default (not opus)
    patchAcpDefaultModel(mergedSettings.model);

    let existingMarketplaces = {};
    if (existsSync(marketplacesFile)) {
      try {
        existingMarketplaces = JSON.parse(readFileSync(marketplacesFile, 'utf8'));
      } catch (e) {
        console.log('[claude-config] Could not parse existing marketplaces, using defaults');
      }
    }

    const mergedMarketplaces = mergeMarketplaces(existingMarketplaces, DEFAULT_MARKETPLACES);
    
    for (const [name, config] of Object.entries(mergedMarketplaces)) {
      if (!config.installLocation) {
        config.installLocation = join(marketplacesDir, name);
      }
      if (!config.lastUpdated) {
        config.lastUpdated = new Date().toISOString();
      }
      
      if (config.source?.repo) {
        cloneMarketplace(name, config.source.repo, config.installLocation);
        config.lastUpdated = new Date().toISOString();
      }
    }

    writeFileSync(marketplacesFile, JSON.stringify(mergedMarketplaces, null, 2));
    console.log('[claude-config] ✓ Marketplaces configured:', Object.keys(mergedMarketplaces).join(', '));

    try {
      execSync(`chown -R abc:abc "${claudeDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    console.log('[claude-config] ✓ Claude Code configuration complete');

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
