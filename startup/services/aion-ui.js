import { spawnAsAbcUser, waitForPort } from '../lib/service-utils.js';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { createWriteStream } from 'fs';
import https from 'https';
import os from 'os';

const PORT = 25808;
const AIONUI_DIR = '/opt/AionUi';
const AIONUI_BINARY = join(AIONUI_DIR, 'AionUi');
let installationInProgress = false;
let installationComplete = false;

function getDebArch() {
  const arch = os.arch();
  return arch === 'x64' ? 'amd64' : 'arm64';
}

function followRedirects(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve(followRedirects(res.headers.location));
      } else {
        resolve(res);
      }
    }).on('error', reject);
  });
}

async function getLatestDebUrl() {
  const debArch = getDebArch();
  const apiUrl = 'https://api.github.com/repos/iOfficeAI/AionUi/releases/latest';
  const res = await fetch(apiUrl);
  const data = await res.json();
  const suffix = `linux-${debArch}.deb`;
  const asset = (data.assets || []).find(a => a.name.endsWith(suffix));
  if (asset) return asset.browser_download_url;
  return `https://github.com/iOfficeAI/AionUi/releases/latest/download/AionUi-latest-${suffix}`;
}

async function downloadAndInstallAionUI() {
  if (installationComplete) return true;
  if (installationInProgress) return false;
  installationInProgress = true;

  try {
    mkdirSync(AIONUI_DIR, { recursive: true });

    if (existsSync(AIONUI_BINARY)) {
      installationComplete = true;
      installationInProgress = false;
      return true;
    }

    const downloadUrl = await getLatestDebUrl();
    console.log(`[aion-ui-install] Downloading from ${downloadUrl}`);
    const debPath = '/tmp/aionui-latest.deb';

    return await new Promise((resolve) => {
      const file = createWriteStream(debPath);
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;
        installationInProgress = !result;
        if (result) installationComplete = true;
        resolve(result);
      };

      followRedirects(downloadUrl).then((response) => {
        if (response.statusCode !== 200) {
          console.log(`[aion-ui-install] HTTP ${response.statusCode}`);
          file.destroy();
          finish(false);
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          try {
            execSync(`mkdir -p ${AIONUI_DIR}`);
            execSync(`dpkg-deb -x ${debPath} ${AIONUI_DIR}`);
            const binaryPath = join(AIONUI_DIR, 'opt/AionUi/AionUi');
            if (existsSync(binaryPath)) {
              execSync(`cp ${binaryPath} ${AIONUI_BINARY}`);
              chmodSync(AIONUI_BINARY, '755');
              execSync(`chown -R abc:abc ${AIONUI_DIR}`);
              console.log('[aion-ui-install] Installation complete');
              finish(true);
            } else {
              console.log('[aion-ui-install] Binary not found in DEB');
              finish(false);
            }
          } catch (e) {
            console.log(`[aion-ui-install] Extraction failed: ${e.message}`);
            finish(false);
          }
        });
      }).catch((e) => {
        console.log(`[aion-ui-install] Download error: ${e.message}`);
        file.destroy();
        finish(false);
      });

      setTimeout(() => {
        if (!done) {
          console.log('[aion-ui-install] Download timeout');
          file.destroy();
          finish(false);
        }
      }, 120000);
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
    console.log('[aion-ui] WARNING: PASSWORD env var not set');
    return;
  }

  try {
    const require = createRequire(import.meta.url);
    const Database = require('/config/.npm-global/lib/node_modules/better-sqlite3');
    const bcrypt = require('/config/node_modules/bcrypt');
    const dbPath = '/config/.config/AionUi/aionui/aionui.db';
    const db = new Database(dbPath);
    const newHash = bcrypt.hashSync(targetPassword, 12).replace('$2b$', '$2a$');
    const stmt = db.prepare(
      'UPDATE users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ?'
    );
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
    console.log(`[aion-ui] Starting on port ${PORT}`);

    downloadAndInstallAionUI().catch((e) => {
      console.log(`[aion-ui-install] Background install failed: ${e.message}`);
    });

    try {
      execSync('rm -rf /config/.config/AionUi/Singleton* 2>/dev/null || true');
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
      if (msg && !msg.includes('Deprecation')) console.log(`[aion-ui] ${msg}`);
    });
    ps.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Deprecation') && !msg.includes('GPU process'))
        console.log(`[aion-ui:err] ${msg}`);
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
