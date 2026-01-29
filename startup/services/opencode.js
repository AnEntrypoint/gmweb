import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { createNpxWrapper, precacheNpmPackage } from '../lib/service-utils.js';

const NAME = 'opencode';
const PKG = 'opencode-ai';

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const binPath = `${dirname(process.execPath)}/${NAME}`;
    console.log(`[${NAME}] Creating wrapper...`);
    if (!createNpxWrapper(binPath, PKG)) {
      console.log(`[${NAME}] Failed to create wrapper`);
      return { pid: 0, process: null, cleanup: async () => {} };
    }
    console.log(`[${NAME}] Wrapper created`);
    precacheNpmPackage(PKG, env);

    console.log(`[${NAME}] Starting opencode acp...`);
    const ps = spawn(binPath, ['acp'], {
      cwd: '/config',
      env: { ...env, HOME: '/config' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.stdout?.on('data', d => {
      console.log(`[${NAME}:acp] ${d.toString().trim()}`);
    });
    ps.stderr?.on('data', d => {
      console.log(`[${NAME}:acp:err] ${d.toString().trim()}`);
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
    const binPath = `${dirname(process.execPath)}/${NAME}`;
    return existsSync(binPath);
  }
};
