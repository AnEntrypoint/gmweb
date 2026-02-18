import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const sleep = promisify(setTimeout);

const NAME = 'agentgui';
const PORT = 9897;
const VERSION_CHECK_INTERVAL = 60000; // 60 seconds

let currentProcess = null;
let currentVersion = null;
let versionCheckTimer = null;
let lastRestartTime = 0;

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${NAME}] [${timestamp}] ${msg}`);
}

// Fetch the latest agentgui version from npm registry
async function getLatestVersion() {
  try {
    const version = execSync('npm view agentgui version', {
      timeout: 5000,
      encoding: 'utf-8'
    }).trim();
    return version;
  } catch (e) {
    log(`Warning: Failed to fetch latest version from npm: ${e.message}`);
    return null;
  }
}

// Get the version of the currently running agentgui process
async function getRunningVersion() {
  try {
    // Try to get version from npm registry cache or package info
    // For bunx packages, we track version when starting
    return currentVersion;
  } catch (e) {
    return null;
  }
}

// Start agentgui process with npx (more reliable with native deps)
async function startAgentGuiProcess(env) {
  const childEnv = {
    ...env,
    HOME: '/config',
    PORT: String(PORT),
    BASE_URL: '/gm',
    HOT_RELOAD: 'false',
    NODE_ENV: 'production'
  };

  // Configure git to use HTTPS instead of SSH for GitHub (for private dep resolution)
  try {
    execSync('git config --global url."https://github.com/".insteadOf ssh://git@github.com/', { timeout: 5000 });
    execSync('git config --global url."https://github.com/".insteadOf git@github.com:', { timeout: 5000 });
  } catch (e) {
    log(`Warning: Failed to configure git URL rewriting: ${e.message}`);
  }

  log('Spawning npx agentgui@latest...');

  const ps = spawn('npx', ['agentgui@latest'], {
    env: childEnv,
    cwd: '/config',
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  ps.unref();

  // Capture initial output for debugging
  ps.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => log(`[stdout] ${line}`));
  });

  ps.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => log(`[stderr] ${line}`));
  });

  return ps;
}

// Gracefully restart the agentgui service
async function restartAgentGui(env, oldVersion, newVersion) {
  // Debounce rapid restarts (minimum 30 seconds between restarts)
  const now = Date.now();
  if (now - lastRestartTime < 30000) {
    log(`Skipping restart (last restart was ${Math.round((now - lastRestartTime) / 1000)}s ago)`);
    return;
  }
  lastRestartTime = now;

  log(`Version mismatch detected: ${oldVersion} -> ${newVersion}. Restarting service...`);

  if (currentProcess && currentProcess.pid) {
    try {
      log(`Sending SIGTERM to process group ${-currentProcess.pid}`);
      process.kill(-currentProcess.pid, 'SIGTERM');
      await sleep(1000);

      // Check if process is still alive
      try {
        process.kill(-currentProcess.pid, 0);
        log(`Process still alive, sending SIGKILL to process group ${-currentProcess.pid}`);
        process.kill(-currentProcess.pid, 'SIGKILL');
      } catch (e) {
        log(`Process terminated cleanly`);
      }
    } catch (e) {
      log(`Warning: Error terminating old process: ${e.message}`);
    }
  }

  // Wait before spawning new process
  await sleep(2000);

  try {
    const newPs = await startAgentGuiProcess(env);
    currentProcess = newPs;
    currentVersion = newVersion;
    log(`✓ Service restarted with version ${newVersion} (PID: ${newPs.pid})`);
  } catch (e) {
    log(`Error: Failed to restart service: ${e.message}`);
  }
}

// Periodic version check and restart logic
async function startVersionChecker(env) {
  async function checkVersion() {
    try {
      const latestVersion = await getLatestVersion();
      if (!latestVersion) {
        log('Skipping version check (npm registry unreachable)');
        return;
      }

      if (currentVersion && latestVersion !== currentVersion) {
        log(`Version check: running=${currentVersion}, latest=${latestVersion}`);
        await restartAgentGui(env, currentVersion, latestVersion);
      } else if (currentVersion) {
        log(`Version check: ${currentVersion} (up to date)`);
      }
    } catch (e) {
      log(`Error during version check: ${e.message}`);
    }
  }

  // Initial check
  await checkVersion();

  // Schedule periodic checks
  versionCheckTimer = setInterval(async () => {
    await checkVersion();
  }, VERSION_CHECK_INTERVAL);

  log(`Version checker started (check interval: ${VERSION_CHECK_INTERVAL / 1000}s)`);
}

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    log('Starting agentgui with npx agentgui@latest...');

    try {
      // Get initial version
      currentVersion = await getLatestVersion();
      if (!currentVersion) {
        log('Warning: Could not determine initial version, proceeding anyway');
        currentVersion = 'unknown';
      } else {
        log(`Initial version: ${currentVersion}`);
      }

      // Start the service
      currentProcess = await startAgentGuiProcess(env);
      log(`✓ Service started in background (PID: ${currentProcess.pid})`);

      // Give process time to start
      await sleep(3000);

      // Start version checker (non-blocking)
      Promise.resolve(startVersionChecker(env)).catch(e => {
        log(`Error starting version checker: ${e.message}`);
      });

      return {
        pid: currentProcess.pid,
        process: currentProcess,
        cleanup: async () => {
          // Stop version checker
          if (versionCheckTimer) {
            clearInterval(versionCheckTimer);
            versionCheckTimer = null;
          }

          // Terminate process
          if (currentProcess && currentProcess.pid) {
            try {
              process.kill(-currentProcess.pid, 'SIGTERM');
              await sleep(1000);
            } catch (e) {
              // ESRCH means process doesn't exist, which is fine
              if (e.code !== 'ESRCH') {
                log(`Warning: SIGTERM error: ${e.message}`);
              }
            }

            try {
              process.kill(-currentProcess.pid, 'SIGKILL');
            } catch (e) {
              // ESRCH means process doesn't exist, which is fine
              if (e.code !== 'ESRCH') {
                log(`Warning: SIGKILL error: ${e.message}`);
              }
            }
          }
        }
      };
    } catch (e) {
      log(`Error starting service: ${e.message}`);
      throw e;
    }
  },

  async health() {
    try {
      return await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          resolve(false);
        });
        socket.connect(PORT, 'localhost');
      });
    } catch (e) {
      log(`Health check error: ${e.message}`);
      return false;
    }
  }
};
