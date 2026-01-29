import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
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
