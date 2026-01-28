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

    const tmuxCmd = 'tmux -f /opt/gmweb-startup/tmux.conf new-session -A -s main -c /config bash -i -l';
    const ps = spawn(binaryPath, ['-p', '9999', '-W', '-T', 'xterm-256color', 'bash', '-c', tmuxCmd], {
      env: { ...env, TERM: 'xterm-256color' },
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
    // Check if port 9999 is listening
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :9999 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
