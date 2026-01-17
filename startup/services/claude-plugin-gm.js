// Claude plugin gm installation service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'claude-plugin-gm',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['claude-marketplace'],

  async start(env) {
    // Wait before starting to ensure marketplace is ready
    await sleep(6000);

    const ps = spawn('sudo', ['-u', 'kasm-user', 'bash', '-c', 'export TMPDIR=/home/kasm-user/.tmp && /home/kasm-user/.local/bin/claude plugin install -s user gm@gm'], {
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
    // Health check for plugin
    return true;
  }
};
