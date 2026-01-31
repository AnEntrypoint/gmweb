// OpenCode Configuration Service
// Sets up glootie-oc extension and configures permissive settings
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const OPENCODE_CONFIG_DIR = '/config/.config/opencode';
const OPENCODE_STORAGE_DIR = '/config/.local/share/opencode/storage';
const GLOOTIE_REPO = 'https://github.com/AnEntrypoint/glootie-oc.git';
const GLOOTIE_DIR = join(OPENCODE_CONFIG_DIR, 'glootie-oc');

// OpenCode settings that allow everything without prompting
const PERMISSIVE_SETTINGS = {
  // Disable all prompts
  "autoApprove": true,
  "autoApproveAll": true,
  "alwaysAllowReadOnly": true,
  "alwaysAllowWrite": true,
  "alwaysAllowExecute": true,
  
  // Tool permissions
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
  
  // API settings
  "apiProvider": "anthropic",
  "model": "claude-sonnet-4",
  
  // Workspace settings
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
    // Clone or update glootie-oc
    if (existsSync(GLOOTIE_DIR)) {
      console.log('[opencode-config] glootie-oc exists, pulling updates...');
      execSync(`cd "${GLOOTIE_DIR}" && git pull origin main`, {
        timeout: 30000,
        stdio: 'pipe'
      });
    } else {
      console.log('[opencode-config] Cloning glootie-oc...');
      execSync(`git clone --depth 1 "${GLOOTIE_REPO}" "${GLOOTIE_DIR}"`, {
        timeout: 60000,
        stdio: 'pipe'
      });
    }
    
    // Install glootie-oc as a dependency in opencode config
    const packageJsonPath = join(OPENCODE_CONFIG_DIR, 'package.json');
    let packageJson = { dependencies: {} };
    
    if (existsSync(packageJsonPath)) {
      try {
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      } catch (e) {}
    }
    
    // Add glootie-oc as file: dependency
    if (!packageJson.dependencies) packageJson.dependencies = {};
    packageJson.dependencies['@opencode-ai/plugin'] = packageJson.dependencies['@opencode-ai/plugin'] || '1.1.47';
    packageJson.dependencies['glootie-oc'] = `file:${GLOOTIE_DIR}`;
    
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    // Run npm install to link glootie-oc
    console.log('[opencode-config] Installing dependencies...');
    execSync(`cd "${OPENCODE_CONFIG_DIR}" && npm install --no-save 2>&1 | tail -5`, {
      timeout: 120000,
      stdio: 'pipe'
    });
    
    console.log('[opencode-config] ✓ glootie-oc installed');
  } catch (e) {
    console.log(`[opencode-config] Warning: Could not install glootie-oc: ${e.message}`);
  }
}

function configureOpenCodeDatabase() {
  console.log('[opencode-config] Configuring OpenCode database for permissive access...');
  
  try {
    // OpenCode stores settings in SQLite database
    // We need to set all tool permissions to "always" allow
    const dbPath = join(OPENCODE_STORAGE_DIR, '../opencode.db');
    
    if (!existsSync(OPENCODE_STORAGE_DIR)) {
      console.log('[opencode-config] OpenCode storage not initialized yet, will configure on first run');
      return;
    }
    
    // Use sqlite3 to update settings
    const sqlCommands = `
      -- Enable all tool permissions without prompting
      UPDATE settings SET value = 'always' WHERE key LIKE 'toolPermission.%';
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.bash', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.computer', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.text_editor', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.read', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.write', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.glob', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.grep', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.list_dir', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('toolPermission.mcp', 'always');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('autoApprove', 'true');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('alwaysAllowReadOnly', 'true');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('alwaysAllowWrite', 'true');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('alwaysAllowExecute', 'true');
    `;
    
    if (existsSync(dbPath)) {
      execSync(`sqlite3 "${dbPath}" "${sqlCommands}"`, { stdio: 'pipe' });
      console.log('[opencode-config] ✓ Database configured for permissive access');
    }
  } catch (e) {
    console.log(`[opencode-config] Note: Database config will apply on first OpenCode run: ${e.message}`);
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
  
  // Merge with permissive settings (permissive settings take precedence)
  const mergedSettings = {
    ...existingSettings,
    ...PERMISSIVE_SETTINGS,
    toolPermissions: {
      ...(existingSettings.toolPermissions || {}),
      ...PERMISSIVE_SETTINGS.toolPermissions
    }
  };
  
  writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));
  console.log('[opencode-config] ✓ OpenCode configured with permissive settings');
  
  // Also configure database if it exists
  configureOpenCodeDatabase();
}

function setupGlootieConfig() {
  console.log('[opencode-config] Setting up glootie-oc configuration...');
  
  try {
    // Copy opencode.json from glootie-oc if it exists
    const glootieConfigSrc = join(GLOOTIE_DIR, 'opencode.json');
    const glootieConfigDest = join(OPENCODE_CONFIG_DIR, 'opencode.json');
    
    if (existsSync(glootieConfigSrc)) {
      const glootieConfig = JSON.parse(readFileSync(glootieConfigSrc, 'utf8'));
      
      let existingConfig = {};
      if (existsSync(glootieConfigDest)) {
        try {
          existingConfig = JSON.parse(readFileSync(glootieConfigDest, 'utf8'));
        } catch (e) {}
      }
      
      // Merge MCP servers
      const mergedConfig = {
        ...existingConfig,
        default_agent: glootieConfig.default_agent || existingConfig.default_agent,
        plugin: glootieConfig.plugin,
        mcp: {
          ...(existingConfig.mcp || {}),
          ...(glootieConfig.mcp || {})
        }
      };
      
      writeFileSync(glootieConfigDest, JSON.stringify(mergedConfig, null, 2));
      console.log('[opencode-config] ✓ glootie-oc configuration merged');
    }
    
    // Copy agents
    const agentsSrcDir = join(GLOOTIE_DIR, 'agents');
    const agentsDestDir = join(OPENCODE_CONFIG_DIR, 'agents');
    
    if (existsSync(agentsSrcDir)) {
      ensureDir(agentsDestDir);
      execSync(`cp -r "${agentsSrcDir}"/* "${agentsDestDir}/" 2>/dev/null || true`, {
        stdio: 'pipe'
      });
      console.log('[opencode-config] ✓ glootie agents copied');
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
    
    ensureDir(OPENCODE_CONFIG_DIR);
    ensureDir(OPENCODE_STORAGE_DIR);
    
    // Create environment file for OpenCode to read on startup
    const envFile = join(OPENCODE_CONFIG_DIR, '.env');
    const envContent = `# OpenCode Environment - Auto-configured for permissive access
OPENCODE_AUTO_APPROVE=true
OPENCODE_ALWAYS_ALLOW_READ=true
OPENCODE_ALWAYS_ALLOW_WRITE=true
OPENCODE_ALWAYS_ALLOW_EXECUTE=true
OPENCODE_DEFAULT_AGENT=gm
OPENCODE_WORKSPACE=/config/workspace
`;
    writeFileSync(envFile, envContent);
    
    // Install glootie-oc extension
    installGlootieOc();
    
    // Configure OpenCode with permissive settings
    configureOpenCode();
    
    // Setup glootie-oc configuration
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
