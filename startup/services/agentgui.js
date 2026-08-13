import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import http from 'http';

const sleep = promisify(setTimeout);
const NAME = 'agentgui';
const PORT = 9897;
const VERSION_CHECK_INTERVAL = 60000;

let currentProcess = null;
let currentVersion = null;
let versionCheckTimer = null;
let lastRestartTime = 0;

const log = (msg) => console.log(`[${NAME}] [${new Date().toISOString()}] ${msg}`);

async function getLatestVersion() {
  try {
    return execSync('npm view agentgui version', { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch (e) {
    log(`Warning: Failed to fetch latest version: ${e.message}`);
    return null;
  }
}

async function getRunningVersion() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/version`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).version || null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function getPortPids(port) {
  // ss is always available; lsof may not be
  try {
    const out = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, { encoding: 'utf8' }).trim();
    const pids = [];
    for (const line of out.split('\n')) {
      const m = line.match(/pid=(\d+)/g);
      if (m) m.forEach(p => { const n = parseInt(p.replace('pid=', ''), 10); if (n > 0) pids.push(n); });
    }
    return pids;
  } catch (e) { return []; }
}

async function killPort(port) {
  try {
    const pids = getPortPids(port);
    for (const n of pids) try { process.kill(n, 'SIGTERM'); } catch (e) {}
    if (pids.length) await sleep(1500);
    const remaining = getPortPids(port);
    for (const n of remaining) try { process.kill(n, 'SIGKILL'); } catch (e) {}
    if (remaining.length) await sleep(500);
  } catch (e) {
    log(`Warning: killPort(${port}): ${e.message}`);
  }
}

async function waitForPortFree(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((resolve) => {
      const s = new net.Socket();
      s.setTimeout(500);
      s.once('connect', () => { s.destroy(); resolve(false); });
      s.once('error', () => resolve(true));
      s.once('timeout', () => { s.destroy(); resolve(true); });
      s.connect(port, 'localhost');
    });
    if (free) return true;
    await sleep(300);
  }
  return false;
}

async function killCurrentProcess() {
  if (currentProcess?.pid) {
    try {
      process.kill(-currentProcess.pid, 'SIGTERM');
      await sleep(1000);
      try { process.kill(-currentProcess.pid, 'SIGKILL'); } catch (e) {}
    } catch (e) {
      log(`Warning: Error terminating process group: ${e.message}`);
    }
    currentProcess = null;
  }
  log(`Killing any process holding port ${PORT}...`);
  await killPort(PORT);
  const free = await waitForPortFree(PORT);
  log(free ? `Port ${PORT} is free` : `Warning: Port ${PORT} still occupied after kill attempts`);
}

async function startAgentGuiProcess(env) {
  const bunxBin = env.BUN_INSTALL
    ? `${env.BUN_INSTALL}/bin/bunx`
    : '/config/.gmweb/cache/.bun/bin/bunx';

  try {
    execSync('git config --global url."https://github.com/".insteadOf ssh://git@github.com/', { timeout: 5000 });
    execSync('git config --global url."https://github.com/".insteadOf git@github.com:', { timeout: 5000 });
  } catch (e) {}

  const fs = await import('fs');

  try {
    const gmExecDir = '/config/.gmweb/npm-global/lib/node_modules/gm-exec';
    const pm2Path = `${gmExecDir}/node_modules/pm2`;
    if (!fs.existsSync(pm2Path)) {
      log('pm2 missing from gm-exec, installing...');
      execSync(`cd "${gmExecDir}" && npm install --no-save 2>&1`, { timeout: 60000, shell: true });
      log('pm2 installed');
    }
  } catch (e) {
    log(`Warning: could not install pm2 for gm-exec: ${e.message}`);
  }

  try {
    const ghBin = execSync('PATH="/config/.local/bin:/config/.gmweb/npm-global/bin:/config/.gmweb/cache/.bun/bin:/usr/local/bin:$PATH" which gh 2>/dev/null || find /config/.gmweb/cache/.config/AionUi/aionui -name gh -type f 2>/dev/null | head -1', { timeout: 10000, encoding: 'utf-8' }).trim();
    if (ghBin) {
      execSync('git config --global --unset-all credential.https://github.com.helper 2>/dev/null || true', { timeout: 5000, shell: true });
      execSync(`git config --global credential.https://github.com.helper "!${ghBin} auth git-credential"`, { timeout: 5000 });
      log(`Set gh credential helper: ${ghBin}`);
    }
  } catch (e) {
    log(`Warning: could not set gh credential helper: ${e.message}`);
  }

  const extraPaths = [
    '/config/.local/bin',
    '/config/.gmweb/npm-global/bin',
    '/config/.gmweb/cache/.bun/bin',
    '/config/nvm/versions/node/v24.13.0/bin',
    '/usr/local/bin',
  ].join(':');
  const augmentedPath = env.PATH ? `${extraPaths}:${env.PATH}` : extraPaths;

  const workspaceDir = '/config/workspace/agentgui';
  const workspaceBin = `${workspaceDir}/bin/gmgui.cjs`;
  const useWorkspace = fs.existsSync(workspaceBin);

  let ps;
  if (useWorkspace) {
    log(`Running agentgui from local workspace: ${workspaceDir} (version checks disabled)`);
    const nodeBin = execSync('which node', { encoding: 'utf-8', env: { ...process.env, PATH: augmentedPath } }).trim();
    ps = spawn(nodeBin, [workspaceBin], {
      env: { ...env, PATH: augmentedPath, HOME: '/config', PORT: String(PORT), BASE_URL: '/gm', HOT_RELOAD: 'false', NODE_ENV: 'production', STARTUP_CWD: '/config' },
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    ps._isWorkspace = true;
  } else {
    ps = spawn(bunxBin, ['agentgui@latest'], {
      env: { ...env, PATH: augmentedPath, HOME: '/config', PORT: String(PORT), BASE_URL: '/gm', HOT_RELOAD: 'false', NODE_ENV: 'production', STARTUP_CWD: '/config' },
      cwd: '/config',
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
  }

  ps.unref();
  ps.stdout.on('data', (d) => d.toString().split('\n').filter(l => l.trim()).forEach(l => log(`[stdout] ${l}`)));
  ps.stderr.on('data', (d) => d.toString().split('\n').filter(l => l.trim()).forEach(l => log(`[stderr] ${l}`)));
  return ps;
}

async function restartAgentGui(env, oldVersion, newVersion) {
  const now = Date.now();
  if (now - lastRestartTime < 30000) {
    log(`Skipping restart (last restart was ${Math.round((now - lastRestartTime) / 1000)}s ago)`);
    return;
  }
  lastRestartTime = now;
  log(`Version mismatch: ${oldVersion} -> ${newVersion}. Restarting...`);
  await killCurrentProcess();
  try {
    currentProcess = await startAgentGuiProcess(env);
    currentVersion = newVersion;
    log(`Service restarted with version ${newVersion} (PID: ${currentProcess.pid})`);
  } catch (e) {
    log(`Error: Failed to restart service: ${e.message}`);
  }
}

async function startVersionChecker(env) {
  async function checkVersion() {
    try {
      const latestVersion = await getLatestVersion();
      if (!latestVersion) { log('Skipping version check (npm registry unreachable)'); return; }
      // Query the running server's actual version (not cached startup version)
      const runningVersion = await getRunningVersion();
      if (!runningVersion) {
        log(`Version check: server not responding, latest=${latestVersion}`);
        // If server is down and we have a newer version, restart
        if (currentVersion && latestVersion !== currentVersion) {
          await restartAgentGui(env, currentVersion, latestVersion);
        }
        return;
      }
      if (runningVersion !== latestVersion) {
        log(`Version check: running=${runningVersion}, latest=${latestVersion} - updating`);
        await restartAgentGui(env, runningVersion, latestVersion);
      } else {
        log(`Version check: ${runningVersion} (up to date)`);
        currentVersion = runningVersion;
      }
    } catch (e) {
      log(`Error during version check: ${e.message}`);
    }
  }

  await checkVersion();
  versionCheckTimer = setInterval(async () => { await checkVersion(); }, VERSION_CHECK_INTERVAL);
  log(`Version checker started (interval: ${VERSION_CHECK_INTERVAL / 1000}s)`);
}

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    log('Starting agentgui with bunx agentgui@latest...');
    lastRestartTime = Date.now();
    try {
      // If port is already occupied (e.g. local dev server), skip spawning
      const occupyingPids = getPortPids(PORT);
      if (occupyingPids.length > 0) {
        log(`Port ${PORT} already occupied by PID(s) ${occupyingPids.join(',')} - skipping spawn, adopting existing process`);
        const { existsSync } = await import('fs');
        if (existsSync('/config/workspace/agentgui/bin/gmgui.cjs')) {
          log('Workspace binary detected: skipping npm version checker (manual updates only)');
        } else {
          currentVersion = await getLatestVersion() || 'unknown';
          Promise.resolve(startVersionChecker(env)).catch(e => log(`Error starting version checker: ${e.message}`));
        }
        return {
          pid: occupyingPids[0],
          process: null,
          cleanup: async () => { await killCurrentProcess(); }
        };
      }
      currentVersion = await getLatestVersion() || 'unknown';
      log(`Initial version: ${currentVersion}`);
      currentProcess = await startAgentGuiProcess(env);
      log(`Service started in background (PID: ${currentProcess.pid})`);
      await sleep(3000);
      if (currentProcess._isWorkspace) {
        log('Workspace mode: skipping npm version checker (manual updates only)');
      } else {
        Promise.resolve(startVersionChecker(env)).catch(e => log(`Error starting version checker: ${e.message}`));
      }
      return {
        pid: currentProcess.pid,
        process: currentProcess,
        cleanup: async () => {
          if (versionCheckTimer) { clearInterval(versionCheckTimer); versionCheckTimer = null; }
          await killCurrentProcess();
        }
      };
    } catch (e) {
      log(`Error starting service: ${e.message}`);
      throw e;
    }
  },

  async health() {
    if (lastRestartTime > 0 && Date.now() - lastRestartTime < 180000) return true;
    try {
      return await new Promise((resolve) => {
        const s = new net.Socket();
        s.setTimeout(1000);
        s.once('connect', () => { s.destroy(); resolve(true); });
        s.once('error', () => resolve(false));
        s.connect(PORT, 'localhost');
      });
    } catch (e) {
      log(`Health check error: ${e.message}`);
      return false;
    }
  }
};
