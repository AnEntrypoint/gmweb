import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createNpxWrapper, precacheNpmPackage } from '../lib/service-utils.js';

const NAME = 'opencode';
const PKG = 'opencode-ai';

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: ['opencode-config', 'glootie-oc'],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const binPath = `${dirname(process.execPath)}/${NAME}`;

    // CRITICAL: Ensure opencode config directory exists with proper permissions
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
      // Ensure proper ownership (abc:abc)
      const { execSync } = await import('child_process');
      execSync(`chown -R abc:abc "${opencodeConfigDir}" 2>/dev/null || true`);
      execSync(`chown -R abc:abc "${opencodeStorageDir}" 2>/dev/null || true`);
      execSync(`chmod -R 755 "${opencodeConfigDir}" 2>/dev/null || true`);
      execSync(`chmod -R 755 "${opencodeStorageDir}" 2>/dev/null || true`);
    } catch (e) {
      console.log(`[${NAME}] Warning: Could not setup opencode directories: ${e.message}`);
    }

    console.log(`[${NAME}] Creating wrapper...`);
    if (!createNpxWrapper(binPath, PKG)) {
      console.log(`[${NAME}] Failed to create wrapper`);
      return { pid: 0, process: null, cleanup: async () => {} };
    }
    console.log(`[${NAME}] Wrapper created`);
    precacheNpmPackage(PKG, env);

    console.log(`[${NAME}] Starting opencode acp...`);
    const ps = spawn(binPath, ['acp'], {
      cwd: homeDir,
      env: { ...env, HOME: homeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

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
      if (code !== 0) {
        console.log(`[${NAME}:exit] Process exited with code ${code}, signal ${signal}`);
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
      return existsSync(binPath);
    } catch (e) {
      return false;
    }
  }
};
