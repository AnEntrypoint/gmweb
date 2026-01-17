// Tmux session management service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'tmux',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('bash', ['-c', `
      sudo -u kasm-user tmux new-session -d -s main -x 120 -y 30
      sleep 1
      sudo -u kasm-user tmux new-window -t main -n sshd
    `], {
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.unref();
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('sudo -u kasm-user tmux list-sessions | grep -q main', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
