// OpenCode Web Editor Service
// Starts the OpenCode web interface on port 9997
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname } from 'path';
import { spawnAsAbcUser, waitForPort } from '../lib/service-utils.js';

const OPENCODE_BIN = `${dirname(process.execPath)}/opencode`;
const HOME_DIR = '/config';
const PORT = 9997;

export default {
  name: 'opencode-web',
  type: 'web',
  requiresDesktop: false,
  dependencies: ['glootie-oc'],

  async start(env) {
    // Check if opencode wrapper exists (created by opencode service)
    if (!existsSync(OPENCODE_BIN)) {
      console.log('[opencode-web] opencode binary not found - opencode service must run first');
      return { pid: null, process: null, cleanup: async () => {} };
    }

    // Initialize OpenCode user directory if needed
    if (!existsSync(`${HOME_DIR}/.opencode`)) {
      console.log('[opencode-web] Initializing OpenCode user directory...');
      try {
        // Use env which already has PATH set correctly from supervisor
        execSync(`${OPENCODE_BIN} --version`, {
          env: { ...env, HOME: HOME_DIR },
          stdio: 'pipe',
          timeout: 30000
        });
      } catch (e) {
        console.log('[opencode-web] Warning: initialization returned:', e.message);
      }
    }

    const password = env.PASSWORD || 'default';
    const fqdn = env.COOLIFY_FQDN || 'localhost:9997';
    
    console.log(`[opencode-web] Starting on port ${PORT}`);
    console.log(`[opencode-web] Password: ${password.substring(0, 3)}***`);
    console.log(`[opencode-web] FQDN: ${fqdn}`);

    // Kill any existing process on port 9997
    try {
      execSync(`lsof -ti:${PORT} | xargs -r kill -9 2>/dev/null || true`);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {}

    // Simple: spawn with supervisor's env - it already has PATH, PASSWORD, HOME set correctly
    const ps = spawnAsAbcUser(
      `${OPENCODE_BIN} web --port ${PORT} --hostname 127.0.0.1 --print-logs`,
      {
        ...env,
        HOME: HOME_DIR,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_EXTERNAL_URL: `https://${fqdn}/code/`,
        OPENCODE_FQDN: fqdn
      }
    );

    ps.stdout?.on('data', (data) => {
      console.log(`[opencode-web] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[opencode-web:err] ${data.toString().trim()}`);
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
    return await waitForPort(PORT, 2000);
  }
};
