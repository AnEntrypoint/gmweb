// Claude Marketplace plugin add service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'claude-marketplace',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['claude-cli'],

  async start(env) {
    // Wait before starting to ensure claude-cli is ready
    await sleep(3000);

    const ps = spawn('sudo', ['-u', 'kasm-user', 'bash', '-c', 'export TMPDIR=/home/kasm-user/.tmp && /home/kasm-user/.local/bin/claude plugin marketplace add AnEntrypoint/gm'], {
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
    // Health check for marketplace
    return true;
  }
};
