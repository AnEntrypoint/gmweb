import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { createNpxWrapper, precacheNpmPackage, waitForPort } from '../lib/service-utils.js';

const NAME = 'gmgui';
const PKG = 'gmgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const binPath = `${dirname(process.execPath)}/${NAME}`;
    console.log(`[${NAME}] Creating wrapper...`);
    if (!createNpxWrapper(binPath, PKG)) {
      console.log(`[${NAME}] Failed to create wrapper`);
      return { pid: 0, process: null, cleanup: async () => {} };
    }
    console.log(`[${NAME}] Wrapper created at ${binPath}`);
    precacheNpmPackage(PKG, env);

    console.log(`[${NAME}] Starting service...`);
    const ps = spawn(binPath, ['start'], {
      cwd: '/config',
      env: { ...env, HOME: '/config', PORT: PORT.toString() },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.stdout?.on('data', d => {
      console.log(`[${NAME}] ${d.toString().trim()}`);
    });
    ps.stderr?.on('data', d => {
      console.log(`[${NAME}:err] ${d.toString().trim()}`);
    });

    ps.unref();

    const portReady = await waitForPort(PORT, 10000);
    if (!portReady) {
      console.warn(`[${NAME}] Service started but port ${PORT} not responding`);
    }

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
