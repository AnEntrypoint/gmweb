import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const NAME = 'gm-install';
const HOME_DIR = '/config';
const LOG_DIR = join(HOME_DIR, 'logs');
const LOG_FILE = join(LOG_DIR, 'gm-install.log');
const INSTALLER_URL = 'https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh';
const INSTALLER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'install-gm.sh');
const GM_EXE = join(HOME_DIR, '.gmnew', 'current', 'gm');
const STATE_FILE = join(HOME_DIR, '.gmnew', 'current', '.gmnew-update.json');
const RETRY_SECONDS = Math.max(30, Number(process.env.GMWEB_GM_INSTALL_RETRY_SECONDS || 300));

let installing = false;
let lastAttempt = 0;

function log(message) {
  const line = `[${NAME}] [${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(LOG_FILE, `${line}\n`, { flag: 'a' });
  } catch (error) {
    console.warn(`[${NAME}] Could not write install log: ${error.message}`);
  }
}

function isHealthy() {
  return existsSync(GM_EXE) && existsSync(STATE_FILE);
}

export function resolveInstallerCommand(env = process.env) {
  const installerArgs = env.GMWEB_GM_MCP_CONFIG
    ? `--mcp-config ${JSON.stringify(env.GMWEB_GM_MCP_CONFIG)}`
    : '';
  const args = ['-c',
    `set +e; ` +
    `installer="$1"; url="$2"; installer_args="$3"; ` +
    `if [ -f "$installer" ]; then ` +
    `  if sh "$installer" $installer_args >> "$4" 2>&1; then exit 0; fi; ` +
    `  printf '[gm-install] vendored installer failed; retrying canonical installer\\n' >> "$4"; ` +
    `fi; ` +
    `curl --retry 3 --retry-delay 1 --retry-all-errors -fsSL "$url" | sh -s -- $installer_args >> "$4" 2>&1`,
    'gm-install',
    INSTALLER_PATH,
    INSTALLER_URL,
    installerArgs,
    LOG_FILE,
  ];
  return {
    command: 'sh',
    args,
    cwd: HOME_DIR,
    detached: true,
    stdio: 'ignore',
    env: {
      ...env,
      HOME: HOME_DIR,
      GMNEW_RELEASE_BASE: env.GMNEW_RELEASE_BASE || 'https://github.com/AnEntrypoint/gm/releases/download/latest',
      GMNEW_SKIP_REGISTER: env.GMNEW_SKIP_REGISTER || '',
      GMNEW_AUTO_UPDATE: env.GMNEW_AUTO_UPDATE === undefined ? '' : String(env.GMNEW_AUTO_UPDATE),
    },
  };
}

export const GM_INSTALL_RUNTIME = {
  NAME,
  LOG_FILE,
  INSTALLER_URL,
  INSTALLER_PATH,
  GM_EXE,
  STATE_FILE,
  RETRY_SECONDS,
};

function startInstaller(env) {
  if (installing) return;
  if (env.GM_INSTALL_DRY_RUN === '1') {
    log('Dry run: resolved installer command without spawning or installing');
    return;
  }
  installing = true;
  lastAttempt = Date.now();
  const resolved = resolveInstallerCommand(env);

  const child = spawn(resolved.command, resolved.args, {
    cwd: resolved.cwd,
    detached: resolved.detached,
    stdio: resolved.stdio,
    env: resolved.env,
  });
  child.on('error', (error) => {
    installing = false;
    log(`Installer spawn failed: ${error.message}`);
  });
  child.on('exit', (code) => {
    installing = false;
    log(`Installer exited with ${code}; health=${isHealthy()}`);
  });
  child.unref();
  log('Started detached canonical gm installer (non-blocking)');
}

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    log(`AUTO GM INSTALL source=${INSTALLER_URL} target=${GM_EXE} update=${env.GMNEW_AUTO_UPDATE || 'default'}`);
    if (env.GM_INSTALL_DRY_RUN === '1') startInstaller(env);
    else if (!isHealthy()) startInstaller(env);
    else log('Existing gm installation is healthy; native auto-update remains active');
    return { pid: 0, process: null, cleanup: async () => {} };
  },

  async health() {
    if (isHealthy()) return true;
    if (!installing && Date.now() - lastAttempt >= RETRY_SECONDS * 1000) {
      log(`Health check: gm missing; retry window ${RETRY_SECONDS}s elapsed`);
      startInstaller(process.env);
    } else {
      log(`Health check: gm not ready; installer=${installing ? 'running' : `waiting ${RETRY_SECONDS}s`}`);
    }
    return false;
  },
};
