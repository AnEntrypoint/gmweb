import { spawnAsAbcUser, waitForPort } from '../lib/service-utils.js';
import { execSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { createWriteStream } from 'fs';
import https from 'https';

const PORT = 25808;
const AIONUI_DIR = '/opt/AionUi';
const AIONUI_BINARY = join(AIONUI_DIR, 'AionUi');
const GITHUB_RELEASE_URL = 'https://github.com/iOfficeAI/AionUi/releases/download/v1.7.6/AionUi-1.7.6-linux-arm64.deb';
let installationInProgress = false;
let installationComplete = false;

async function downloadAndInstallAionUI() {
  if (installationComplete) {
    console.log('[aion-ui-install] Binary already installed');
    return true;
  }

  if (installationInProgress) {
    console.log('[aion-ui-install] Installation already in progress');
    return false;
  }

  installationInProgress = true;

  try {
    mkdirSync(AIONUI_DIR, { recursive: true });

    if (existsSync(AIONUI_BINARY)) {
      console.log('[aion-ui-install] Binary exists at', AIONUI_BINARY);
      installationComplete = true;
      return true;
    }

    console.log('[aion-ui-install] Downloading AionUI from GitHub...');
    const debPath = '/tmp/aionui-latest.deb';

    return await new Promise((resolve) => {
      const file = createWriteStream(debPath);
      let requestClosed = false;

      const handleResponse = (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.destroy();
          const redirectUrl = response.headers.location;
          console.log('[aion-ui-install] Following redirect...');
          https.get(redirectUrl, handleResponse).on('error', handleError);
          return;
        }

        if (response.statusCode !== 200) {
          console.log(`[aion-ui-install] Download failed: HTTP ${response.statusCode}`);
          file.destroy();
          installationInProgress = false;
          requestClosed = true;
          resolve(false);
          return;
        }

        response.pipe(file);
      };

      const handleError = (e) => {
        console.log(`[aion-ui-install] Download error: ${e.message}`);
        file.destroy();
        installationInProgress = false;
        requestClosed = true;
        resolve(false);
      };

      const req = https.get(GITHUB_RELEASE_URL, (response) => {
        handleResponse(response);

        file.on('finish', () => {
          file.close();
          if (requestClosed) return;

          console.log('[aion-ui-install] Downloaded, extracting DEB...');

          try {
            execSync(`mkdir -p ${AIONUI_DIR}`);
            execSync(`dpkg-deb -x ${debPath} ${AIONUI_DIR}`);

            const binaryPath = join(AIONUI_DIR, 'opt/AionUi/AionUi');
            if (existsSync(binaryPath)) {
              execSync(`cp ${binaryPath} ${AIONUI_BINARY}`);
              chmodSync(AIONUI_BINARY, '755');
              execSync(`chown -R abc:abc ${AIONUI_DIR}`);
              console.log('[aion-ui-install] ✓ Installation complete');
              installationComplete = true;
              installationInProgress = false;
              requestClosed = true;
              resolve(true);
            } else {
              console.log('[aion-ui-install] Binary not found in extracted DEB');
              installationInProgress = false;
              requestClosed = true;
              resolve(false);
            }
          } catch (e) {
            console.log(`[aion-ui-install] Extraction failed: ${e.message}`);
            installationInProgress = false;
            requestClosed = true;
            resolve(false);
          }
        });
      });

      req.on('error', handleError);

      const timeoutHandle = setTimeout(() => {
        if (requestClosed) return;
        console.log('[aion-ui-install] Download timeout');
        req.abort();
        file.destroy();
        installationInProgress = false;
        requestClosed = true;
        resolve(false);
      }, 120000);

      file.on('close', () => {
        clearTimeout(timeoutHandle);
      });
    });
  } catch (e) {
    console.log(`[aion-ui-install] Error: ${e.message}`);
    installationInProgress = false;
    return false;
  }
}

async function setCredentialsFromEnv() {
  const targetPassword = process.env.AIONUI_PASSWORD || process.env.PASSWORD;
  const targetUsername = process.env.AIONUI_USERNAME || 'admin';
  if (!targetPassword) {
    console.log('[aion-ui] WARNING: PASSWORD env var not set - login disabled');
    return;
  }

  try {
    const require = createRequire(import.meta.url);
    const Database = require('/config/.npm-global/lib/node_modules/better-sqlite3');
    const bcrypt = require('/config/node_modules/bcrypt');

    const dbPath = '/config/.config/AionUi/aionui/aionui.db';
    const db = new Database(dbPath);
    const newHash = bcrypt.hashSync(targetPassword, 12).replace('$2b$', '$2a$');
    const stmt = db.prepare('UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ?');
    const result = stmt.run(targetUsername, newHash, Date.now(), 'system_default_user');
    db.close();
    if (result.changes > 0) console.log(`[aion-ui] Credentials set: ${targetUsername}`);
  } catch (e) {
    console.log(`[aion-ui] Credentials setup: ${e.message}`);
  }
}

export default {
  name: 'aion-ui',
  type: 'web',
  requiresDesktop: true,
  dependencies: [],

  async start(env) {
    console.log(`[aion-ui] Starting AionUi WebUI on port ${PORT}`);

    downloadAndInstallAionUI().catch((e) => {
      console.log(`[aion-ui-install] Background installation failed: ${e.message}`);
    });

    try {
      execSync('rm -rf /config/.config/AionUi/SingletonLock /config/.config/AionUi/SingletonCookie /config/.config/AionUi/SingletonSocket 2>/dev/null || true');
    } catch (e) {}

    try {
      execSync('pkill -f AionUi || true');
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {}

    const serviceEnv = {
      ...env,
      DISPLAY: ':1',
      AIONUI_PORT: String(PORT),
      AIONUI_ALLOWED_ORIGINS: '*'
    };

    const ps = spawnAsAbcUser(
      `/opt/AionUi/AionUi --no-sandbox --webui --remote --port ${PORT}`,
      serviceEnv,
      '/config'
    );

    ps.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Deprecation')) {
        console.log(`[aion-ui] ${msg}`);
      }
    });
    ps.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Deprecation') && !msg.includes('GPU process')) {
        console.log(`[aion-ui:err] ${msg}`);
      }
    });

    ps.unref();
    setTimeout(() => setCredentialsFromEnv(), 8000);

    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGTERM');
          await new Promise(r => setTimeout(r, 2000));
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    const startTime = Date.now();
    const timeout = 60000;

    while (Date.now() - startTime < timeout) {
      if (!existsSync(AIONUI_BINARY)) {
        if (installationInProgress || !installationComplete) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        return false;
      }

      const portReady = await waitForPort(PORT, 5000);
      if (portReady) return true;
    }

    return false;
  }
};
