import { execSync } from 'child_process';
import { existsSync, copyFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const NAME = 'cron';
const CRONTAB_PATH = '/config/crontab';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CRONTAB = join(__dirname, '..', 'crontab.default');

function ensureCrontab() {
  if (!existsSync(CRONTAB_PATH)) {
    if (existsSync(DEFAULT_CRONTAB)) {
      console.log(`[${NAME}] Creating default crontab at ${CRONTAB_PATH}`);
      copyFileSync(DEFAULT_CRONTAB, CRONTAB_PATH);
    } else {
      console.log(`[${NAME}] No default crontab template found at ${DEFAULT_CRONTAB}`);
      return false;
    }
  }
  try {
    chmodSync(CRONTAB_PATH, 0o644);
    execSync(`chown abc:abc "${CRONTAB_PATH}" 2>/dev/null || true`, { stdio: 'pipe' });
  } catch (e) {}
  return true;
}

function loadCrontab() {
  try {
    execSync(`crontab -u abc "${CRONTAB_PATH}" 2>&1`, { stdio: 'pipe', shell: true, timeout: 5000 });
    console.log(`[${NAME}] Loaded crontab from ${CRONTAB_PATH}`);
    return true;
  } catch (e) {
    console.log(`[${NAME}:err] Failed to load crontab: ${e.message}`);
    return false;
  }
}

function isCronRunning() {
  try {
    execSync('pgrep -x cron', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function startCronDaemon() {
  try {
    execSync('sudo cron', { stdio: 'pipe', timeout: 5000 });
    console.log(`[${NAME}] crond started via sudo cron`);
    return true;
  } catch (e) {
    console.log(`[${NAME}:err] Failed to start crond: ${e.message}`);
    return false;
  }
}

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting cron service...`);

    try {
      execSync('which cron', { stdio: 'pipe' });
    } catch (e) {
      console.log(`[${NAME}] cron binary not found - service unavailable`);
      return { pid: null, process: null, cleanup: async () => {} };
    }

    if (!ensureCrontab()) {
      console.log(`[${NAME}] No crontab available - starting crond without user crontab`);
    } else {
      loadCrontab();
    }

    if (!isCronRunning()) {
      startCronDaemon();
    } else {
      console.log(`[${NAME}] cron daemon already running (s6 svc-cron)`);
    }

    let pid = null;
    try {
      pid = parseInt(execSync('pgrep -x cron', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0], 10);
    } catch (e) {}

    return {
      pid: pid || 0,
      process: null,
      cleanup: async () => {}
    };
  },

  async health() {
    if (!isCronRunning()) {
      console.log(`[${NAME}] cron daemon not running, restarting...`);
      ensureCrontab();
      loadCrontab();
      startCronDaemon();
      return isCronRunning();
    }

    if (existsSync(CRONTAB_PATH)) {
      try {
        loadCrontab();
      } catch (e) {}
    }

    return true;
  }
};
