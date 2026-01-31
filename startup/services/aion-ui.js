import { spawnAsAbcUser, waitForPort } from '../lib/service-utils.js';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

const PORT = 25808;
const AIONUI_DIR = '/config/workspace/aionui';
const AIONUI_BINARY = join(AIONUI_DIR, 'AionUi');
const DEB_PATH = '/tmp/aionui-latest.deb';
const NODE_BIN_DIR = dirname(process.execPath);
const GLOBAL_MODULES = join(NODE_BIN_DIR, '..', 'lib', 'node_modules');
let installationInProgress = false;
let installationComplete = false;
let installationFailed = false;

function getDebArch() { return os.arch() === 'x64' ? 'amd64' : 'arm64'; }

function getLatestDebUrl() {
  try {
    const raw = execSync('curl -sfL "https://api.github.com/repos/iOfficeAI/AionUi/releases/latest"', { timeout: 30000 }).toString();
    const asset = (JSON.parse(raw).assets || []).find(a => a.name.endsWith(`linux-${getDebArch()}.deb`));
    if (asset) return asset.browser_download_url;
  } catch (e) { console.log(`[aion-ui-install] API lookup failed: ${e.message}`); }
  return `https://github.com/iOfficeAI/AionUi/releases/latest/download/AionUi-latest-linux-${getDebArch()}.deb`;
}

function extractDeb() {
  try {
    execSync(`sudo rm -rf ${AIONUI_DIR}/opt ${AIONUI_DIR}/usr 2>/dev/null; sudo mkdir -p ${AIONUI_DIR}`);
    execSync(`sudo dpkg-deb -x ${DEB_PATH} ${AIONUI_DIR}`);
    const nestedDir = join(AIONUI_DIR, 'opt/AionUi');
    if (!existsSync(join(nestedDir, 'AionUi'))) return false;
    execSync(`sudo cp -a ${nestedDir}/* ${AIONUI_DIR}/`);
    execSync(`sudo rm -rf ${AIONUI_DIR}/opt ${AIONUI_DIR}/usr`);
    execSync(`sudo chmod 755 ${AIONUI_BINARY}`);
    execSync(`sudo chown -R abc:abc ${AIONUI_DIR}`);
    return true;
  } catch (e) {
    console.log(`[aion-ui-install] Extraction failed: ${e.message}`);
    return false;
  }
}

function installElectronDeps() {
  try { execSync('dpkg -s libgbm1 2>/dev/null', { stdio: 'pipe' }); } catch (e) {
    try {
      execSync(
        'apt-get update -qq && apt-get install -y --no-install-recommends ' +
        'libgbm1 libgtk-3-0 libnss3 libxss1 libasound2 libatk-bridge2.0-0 ' +
        'libdrm2 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 ' +
        'libcups2 libdbus-1-3 libexpat1 libfontconfig1 libx11-6 libx11-xcb1 ' +
        'libxcb1 libxext6 libxfixes3 libxi6 libxrender1 libxtst6 2>/dev/null',
        { stdio: 'pipe', timeout: 120000 }
      );
    } catch (e2) { console.log(`[aion-ui-install] Electron deps failed: ${e2.message}`); }
  }
}

function markComplete() {
  installationComplete = true;
  installationInProgress = false;
  installElectronDeps();
}

async function downloadAndInstallAionUI() {
  if (installationComplete) return true;
  if (installationInProgress || installationFailed) return false;
  installationInProgress = true;
  try {
    execSync(`sudo mkdir -p ${AIONUI_DIR}`);
    // If binary already exists in persistent /config location, don't re-download
    if (existsSync(AIONUI_BINARY)) {
      markComplete();
      return true;
    }

    // Check if we already have the latest deb downloaded in /tmp
    if (existsSync(DEB_PATH) && extractDeb()) { markComplete(); return true; }

    const url = getLatestDebUrl();
    console.log(`[aion-ui-install] Downloading: ${url}`);
    for (let i = 1; i <= 3; i++) {
      try {
        execSync(`curl -fL --max-redirs 10 --retry 3 --retry-delay 5 -o ${DEB_PATH} "${url}"`, { stdio: 'pipe', timeout: 600000 });
        if (existsSync(DEB_PATH) && extractDeb()) { markComplete(); return true; }
      } catch (e) {
        console.log(`[aion-ui-install] Attempt ${i}/3 failed: ${e.message}`);
        if (i < 3) await new Promise(r => setTimeout(r, 5000));
      }
    }
    installationInProgress = false;
    installationFailed = true;
    console.log(`[aion-ui-install] All download attempts exhausted`);
    return false;
  } catch (e) {
    console.log(`[aion-ui-install] Error: ${e.message}`);
    installationInProgress = false;
    installationFailed = true;
    return false;
  }
}

async function setCredentialsFromEnv(attempt = 0) {
  const pw = process.env.AIONUI_PASSWORD || process.env.PASSWORD;
  const user = process.env.AIONUI_USERNAME || 'admin';
  if (!pw) return;
  const MAX_ATTEMPTS = 6;
  const RETRY_DELAY = 5000;

  try {
    const require = createRequire(import.meta.url);
    // Use explicit paths to avoid resolution issues
    let Database, bcrypt;
    try { Database = require('/config/usr/local/lib/node_modules/better-sqlite3'); } catch (e) { Database = require('better-sqlite3'); }
    try { bcrypt = require('/config/.gmweb-deps/node_modules/bcrypt'); } catch (e) { bcrypt = require('bcrypt'); }
    
    const dbPath = '/config/.config/AionUi/aionui/aionui.db';

    if (!existsSync(dbPath)) {
      if (attempt < MAX_ATTEMPTS) {
        setTimeout(() => setCredentialsFromEnv(attempt + 1), RETRY_DELAY);
        return;
      }
      return;
    }

    const db = new Database(dbPath);
    const hash = bcrypt.hashSync(pw, 12).replace('$2b$', '$2a$');
    db.prepare('UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ? OR rowid = 1')
      .run(user, hash, Date.now(), 'system_default_user');
    console.log(`[aion-ui] Credentials updated: ${user}`);
    db.close();
  } catch (e) {
    if (attempt < MAX_ATTEMPTS) {
      setTimeout(() => setCredentialsFromEnv(attempt + 1), RETRY_DELAY);
    }
  }
}

export default {
  name: 'aion-ui',
  type: 'web',
  requiresDesktop: true,
  dependencies: ['claude-config'],

  async start(env) {
    console.log(`[aion-ui] Starting on port ${PORT}`);

    // Wait for background installations to complete (marker file created by custom_startup.sh)
    // This ensures AionUI has access to all CLI tools (opencode, npm packages, etc.)
    let installations_complete = false;
    for (let i = 0; i < 180; i++) {  // Wait up to 3 minutes
      if (existsSync('/tmp/gmweb-installs-complete')) {
        console.log('[aion-ui] Background installations detected');
        installations_complete = true;
        break;
      }
      if (i === 0 || i === 60 || i === 120) {
        console.log(`[aion-ui] Waiting for installations... (attempt ${i}/180)`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!installations_complete) {
      console.log('[aion-ui] Timeout waiting for installations, starting anyway');
    }

    // Only download/install if binary doesn't exist (persistent installation in /config)
    if (!existsSync(AIONUI_BINARY)) {
      console.log('[aion-ui] Binary not found, downloading...');
      downloadAndInstallAionUI().catch(e => console.log(`[aion-ui-install] ${e.message}`));
    } else {
      console.log('[aion-ui] Using existing installation from /config/workspace/aionui');
    }

    try { execSync('rm -rf /config/.config/AionUi/Singleton* 2>/dev/null || true'); } catch (e) {}
    try { execSync('pkill -f AionUi || true'); await new Promise(r => setTimeout(r, 500)); } catch (e) {}
    
    // Ensure NVM bin directory is in PATH so AionUI can find claude-code-acp
    const nvmBinPath = dirname(process.execPath);
    const envPath = env.PATH || process.env.PATH || '';
    const pathWithNvm = envPath.includes(nvmBinPath) ? envPath : `${nvmBinPath}:${envPath}`;
    
    const serviceEnv = { 
      ...env, 
      DISPLAY: ':1', 
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', 
      AIONUI_PORT: String(PORT), 
      AIONUI_ALLOWED_ORIGINS: '*',
      PATH: pathWithNvm
    };
    // Source bash profile to ensure AionUI has full CLI context (opencode, npm packages, etc.)
    // Start in /config directory so AionUI treats it as home for file access
    const command = `cd /config && source /config/.profile && source /config/.bashrc 2>/dev/null || true && ${AIONUI_BINARY} --no-sandbox --webui --remote --port ${PORT}`;
    const ps = spawnAsAbcUser(command, serviceEnv);
    ps.stdout?.on('data', d => { const m = d.toString().trim(); if (m && !m.includes('Deprecation')) console.log(`[aion-ui] ${m}`); });
    ps.stderr?.on('data', d => { const m = d.toString().trim(); if (m && !m.includes('Deprecation') && !m.includes('GPU process')) console.log(`[aion-ui:err] ${m}`); });
    ps.unref();
    setTimeout(() => setCredentialsFromEnv(), 8000);
    return {
      pid: ps.pid, process: ps,
      cleanup: async () => {
        try { process.kill(-ps.pid, 'SIGTERM'); await new Promise(r => setTimeout(r, 2000)); process.kill(-ps.pid, 'SIGKILL'); } catch (e) {}
      }
    };
  },

  async health() {
    if (!existsSync(AIONUI_BINARY)) {
      if (installationInProgress || installationFailed) return true;
      downloadAndInstallAionUI().catch(() => {});
      return true;
    }
    return waitForPort(PORT, 10000);
  }
};
