import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

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

function createClaudeCodeAcpBridge(nodePath) {
  try {
    const nodeModulesDir = join(nodePath, 'lib', 'node_modules');
    const acpDir = join(nodeModulesDir, '@zed-industries', 'claude-code-acp');
    const binDir = join(nodePath, 'bin');

    try {
      execSync(`rm -rf "${acpDir}"`, { stdio: 'pipe' });
    } catch (e) {}

    try {
      execSync(`npm install --prefix "${nodeModulesDir}/.." @zed-industries/claude-code-acp@latest`, {
        stdio: 'pipe',
        timeout: 120000,
        env: { ...process.env, NPM_CONFIG_FETCH_TIMEOUT: '120000' }
      });
    } catch (e) {
      console.log(`[claude-config] Warning: npm install failed, will retry: ${e.message}`);
      return;
    }

    const binPath = join(binDir, 'claude-code-acp');
    try {
      execSync(`rm -f "${binPath}"`, { stdio: 'pipe' });
    } catch (e) {}

    execSync(`ln -s ../lib/node_modules/@zed-industries/claude-code-acp/dist/index.js "${binPath}"`, { stdio: 'pipe' });
    chmodSync(binPath, 0o755);

    // Also create symlink in /usr/local/bin for easier discovery by apps like AionUI
    try {
      execSync('mkdir -p /usr/local/bin', { stdio: 'pipe' });
      execSync(`rm -f /usr/local/bin/claude-code-acp`, { stdio: 'pipe' });
      execSync(`ln -s "${binPath}" /usr/local/bin/claude-code-acp`, { stdio: 'pipe' });
      console.log('[claude-config] ✓ Created /usr/local/bin symlink for ACP bridge');
    } catch (e) {
      console.log(`[claude-config] Warning: Could not create /usr/local/bin symlink: ${e.message}`);
    }

    console.log('[claude-config] ✓ Installed and linked @zed-industries/claude-code-acp');
  } catch (e) {
    console.log(`[claude-config] Warning: Could not setup ACP bridge: ${e.message}`);
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

    const nvmDir = env.NVM_DIR || join(env.HOME || '/config', 'nvm');
    const nodeVersionsDir = join(nvmDir, 'versions', 'node');
    if (existsSync(nodeVersionsDir)) {
      const versions = readdirSync(nodeVersionsDir).sort().reverse();
      if (versions.length > 0) {
        const latestNode = join(nodeVersionsDir, versions[0]);
        createClaudeCodeAcpBridge(latestNode);
      }
    }

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
