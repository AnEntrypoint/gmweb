// Web terminal service using ttyd
// ttyd is a simple web-based terminal that exposes a shell over HTTP/WebSocket
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'webssh2',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const binaryPath = '/usr/bin/ttyd';

    // Check if ttyd binary exists
    if (!existsSync(binaryPath)) {
      console.log('[webssh2] ttyd binary not found - service unavailable');
      return {
        pid: null,
        process: null,
        cleanup: async () => {}
      };
    }

    const { execSync } = await import('child_process');
    try {
      execSync('fuser -k 9999/tcp', { stdio: 'pipe' });
      await sleep(500);
    } catch (e) {}

    const shellEnv = {
      ...env,
      TERM: 'xterm-256color',
      HOME: '/config',
      USER: 'abc',
      SHELL: '/bin/bash'
    };

    // Start bash as login shell (-l) and interactive (-i) to load .bashrc and .profile
    // This ensures NVM, PATH, and all user configurations are loaded
    const ps = spawn(binaryPath, ['-p', '9999', '-W', '-T', 'xterm-256color', '/bin/bash', '-l', '-i'], {
      cwd: '/config',
      env: shellEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[webssh2] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[webssh2:err] ${data.toString().trim()}`);
    });

    ps.unref();

    return {
      pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-pid, 'SIGKILL');
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    // Check if port 9999 is listening with retries for ttyd startup
    const { execSync } = await import('child_process');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Use ss (socket statistics) with explicit grep to detect LISTEN state
        // ss shows state column, we need to verify port exists AND shows LISTEN
        const output = execSync('ss -tlnp 2>/dev/null | grep ":9999"', {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          timeout: 2000,
          encoding: 'utf8'
        });
        // Verify output contains LISTEN keyword (indicates port is actually listening)
        if (output && output.includes('LISTEN')) {
          return true;
        }
      } catch (e) {
        // Command failed or output was empty
        if (attempt < 2) await sleep(500);
      }
    }
    return false;
  }
};
