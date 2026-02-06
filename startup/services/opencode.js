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
      execSync(`sudo chown -R abc:abc "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
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
