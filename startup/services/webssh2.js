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

    // Start ttyd on port 9999 with tmux session (shared with GUI terminal)
    // -T xterm-256color ensures color terminal type
    // tmux new-session -A -s main bash: attach to 'main' session or create with bash shell
    // Explicit bash ensures .bashrc is sourced and PATH is configured
    const ps = spawn(binaryPath, ['-p', '9999', '-W', '-T', 'xterm-256color', 'tmux', 'new-session', '-A', '-s', 'main', 'bash'], {
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
