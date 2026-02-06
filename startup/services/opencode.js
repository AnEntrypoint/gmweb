import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { arch, platform } from 'os';
import { createNpxWrapper, precacheNpmPackage } from '../lib/service-utils.js';

const NAME = 'opencode';
const PKG = 'opencode-ai';

function resolveOpencodeBinary() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const p = platformMap[platform()] || platform();
  const a = archMap[arch()] || arch();
  const platformPkg = `opencode-${p}-${a}`;
  const npmGlobalLib = '/config/.gmweb/npm-global/lib/node_modules';
  const binCandidate = join(npmGlobalLib, platformPkg, 'bin', 'opencode');
  if (existsSync(binCandidate)) {
    return binCandidate;
  }
  return null;
}

function installPlatformBinary() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const p = platformMap[platform()] || platform();
  const a = archMap[arch()] || arch();
  const platformPkg = `opencode-${p}-${a}`;
  try {
    console.log(`[${NAME}] Installing ${PKG} and ${platformPkg} globally...`);
    execSync(`npm install -g ${PKG} ${platformPkg} 2>&1`, {
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, HOME: '/config' }
    });
    console.log(`[${NAME}] Installed ${PKG} + ${platformPkg}`);
    return true;
  } catch (e) {
    console.log(`[${NAME}] npm install failed: ${e.message}`);
    return false;
  }
}

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: ['opencode-config', 'glootie-oc'],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const binPath = `${dirname(process.execPath)}/${NAME}`;

    const opencodeConfigDir = `${homeDir}/.config/opencode`;
    const opencodeStorageDir = `${homeDir}/.local/share/opencode/storage`;
    try {
      if (!existsSync(opencodeConfigDir)) {
        mkdirSync(opencodeConfigDir, { recursive: true });
        console.log(`[${NAME}] Created opencode config directory: ${opencodeConfigDir}`);
      }
      if (!existsSync(opencodeStorageDir)) {
        mkdirSync(opencodeStorageDir, { recursive: true });
        console.log(`[${NAME}] Created opencode storage directory: ${opencodeStorageDir}`);
      }
      execSync(`sudo chown -R abc:abc "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      console.log(`[${NAME}] Warning: Could not setup opencode directories: ${e.message}`);
    }

    let opencodeBinPath = resolveOpencodeBinary();
    if (!opencodeBinPath) {
      installPlatformBinary();
      opencodeBinPath = resolveOpencodeBinary();
    }

    if (opencodeBinPath) {
      console.log(`[${NAME}] Using platform binary: ${opencodeBinPath}`);
    } else {
      console.log(`[${NAME}] Platform binary not found, falling back to npx wrapper`);
    }

    console.log(`[${NAME}] Creating wrapper...`);
    if (!createNpxWrapper(binPath, PKG)) {
      console.log(`[${NAME}] Failed to create wrapper`);
      return { pid: 0, process: null, cleanup: async () => {} };
    }
    console.log(`[${NAME}] Wrapper created`);
    precacheNpmPackage(PKG, env);

    const spawnEnv = { ...env, HOME: homeDir };
    if (opencodeBinPath) {
      spawnEnv.OPENCODE_BIN_PATH = opencodeBinPath;
    }

    console.log(`[${NAME}] Starting opencode acp...`);
    const ps = spawn(binPath, ['acp'], {
      cwd: homeDir,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true
    });

    let lastExitCode = null;
    ps.stdout?.on('data', d => {
      console.log(`[${NAME}:acp] ${d.toString().trim()}`);
    });
    ps.stderr?.on('data', d => {
      console.log(`[${NAME}:acp:err] ${d.toString().trim()}`);
    });

    ps.on('error', (err) => {
      console.log(`[${NAME}:error] Process error: ${err.message}`);
    });

    ps.on('exit', (code, signal) => {
      lastExitCode = code;
      if (code !== 0) {
        console.log(`[${NAME}:exit] Process exited with code ${code}, signal ${signal}`);
        console.log(`[${NAME}] OpenCode ACP failed to start. AgentGUI will still work and list opencode as an available agent, but ACP features won't be available until this is fixed.`);
      }
    });

    ps.unref();
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
    try {
      const binPath = `${dirname(process.execPath)}/${NAME}`;
      // OpenCode binary existence is acceptable - the ACP process may have failed to start
      // but the binary is still available for discovery by agentgui
      return existsSync(binPath);
    } catch (e) {
      return false;
    }
  }
};
