import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const NAME = 'proxypilot';
const PP_DIR = '/config/proxypilot';
const PP_BIN = join(PP_DIR, 'proxypilot');
const REPO_URL = 'https://github.com/Finesssee/ProxyPilot.git';
const GIT_TAG = 'v6.6.99';
const HOME_DIR = '/config';

async function execAsync(cmd, cwd = null) {
  return new Promise((resolve, reject) => {
    try {
      const result = execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

async function setupGitRepo() {
  mkdirSync(PP_DIR, { recursive: true });

  try {
    if (!existsSync(join(PP_DIR, '.git'))) {
      console.log(`[${NAME}] Cloning ProxyPilot repository...`);
      await execAsync(`git clone --depth 1 --branch ${GIT_TAG} ${REPO_URL} .`, PP_DIR);
    } else {
      console.log(`[${NAME}] Updating ProxyPilot repository...`);
      await execAsync(`git fetch origin tag ${GIT_TAG}`, PP_DIR);
      await execAsync(`git checkout ${GIT_TAG}`, PP_DIR);
    }
    return true;
  } catch (err) {
    console.log(`[${NAME}:err] Git setup failed: ${err.message}`);
    return false;
  }
}

async function buildBinary() {
  try {
    console.log(`[${NAME}] Building ProxyPilot binary...`);
    const buildCmd = 'go mod download && go build -o proxypilot ./cmd/server';

    try {
      execSync('command -v go', { stdio: 'pipe', shell: '/bin/bash' });
    } catch {
      console.log(`[${NAME}] Go not found, installing...`);
      const arch = execSync('uname -m', { encoding: 'utf8' }).trim() === 'x86_64' ? 'amd64' : 'arm64';
      const goDir = join(HOME_DIR, 'go-install');
      mkdirSync(goDir, { recursive: true });

      const goUrl = `https://go.dev/dl/go1.24.0.linux-${arch}.tar.gz`;
      console.log(`[${NAME}] Downloading Go from ${goUrl}...`);

      await execAsync(`curl -sL "${goUrl}" | tar -xz`, goDir);
      process.env.PATH = `${goDir}/go/bin:${process.env.PATH}`;
    }

    await execAsync(buildCmd, PP_DIR);
    console.log(`[${NAME}] ✓ ProxyPilot built successfully`);
    return true;
  } catch (err) {
    console.log(`[${NAME}:err] Build failed: ${err.message}`);
    return false;
  }
}

async function startBinary() {
  try {
    if (!existsSync(PP_BIN)) {
      console.log(`[${NAME}] Binary not found at ${PP_BIN}`);
      return null;
    }

    const configPath = join(PP_DIR, 'config.yaml');
    const examplePath = join(PP_DIR, 'config.example.yaml');
    if (!existsSync(configPath) && existsSync(examplePath)) {
      console.log(`[${NAME}] Copying config.yaml...`);
      copyFileSync(examplePath, configPath);
    }

    mkdirSync(join(HOME_DIR, '.cli-proxy-api'), { recursive: true });

    try {
      execSync(`pkill -f "${PP_BIN}"`, { stdio: 'pipe' });
    } catch {}

    console.log(`[${NAME}] Starting ProxyPilot daemon...`);
    const ps = spawn(PP_BIN, [], {
      cwd: PP_DIR,
      env: { ...process.env, HOME: HOME_DIR },
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    ps.unref();

    await new Promise(r => setTimeout(r, 1500));

    try {
      execSync(`pgrep -f "${PP_BIN}"`, { stdio: 'pipe' });
      console.log(`[${NAME}] ✓ ProxyPilot started on :8317`);
      return { pid: ps.pid };
    } catch {
      console.log(`[${NAME}] WARNING: ProxyPilot start may have failed`);
      return { pid: ps.pid };
    }
  } catch (err) {
    console.log(`[${NAME}:err] Start failed: ${err.message}`);
    return null;
  }
}

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: ['opencode', 'aion-ui', 'claude-config'],

  async start(env) {
    console.log(`[${NAME}] Setting up ProxyPilot...`);

    let needsUpdate = true;
    if (existsSync(PP_BIN)) {
      const mtime = execSync(`stat -c %Y "${PP_BIN}"`, { encoding: 'utf8' }).trim();
      const age = (Date.now() / 1000) - parseInt(mtime);
      needsUpdate = age > 86400;
    }

    if (needsUpdate) {
      const gitOk = await setupGitRepo();
      if (gitOk) {
        await buildBinary();
      }
    }

    const ps = await startBinary();

    return {
      pid: ps?.pid || 0,
      process: ps,
      cleanup: async () => {
        if (ps?.pid) {
          try {
            execSync(`kill -9 ${ps.pid}`, { stdio: 'pipe' });
          } catch (e) {}
        }
      }
    };
  },

  async health() {
    if (!existsSync(PP_BIN)) {
      return false;
    }
    try {
      execSync(`pgrep -f "${PP_BIN}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
};
