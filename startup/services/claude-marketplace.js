// Claude Marketplace plugin add service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const WEBTOP_USER = process.env.SUDO_USER || 'abc';
const HOME_DIR = process.env.HOME || '/config';

export default {
  name: 'claude-marketplace',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['claude-cli'],

  async start(env) {
    // Wait before starting to ensure claude-cli is ready
    await sleep(3000);

    const ps = spawn('sudo', ['-u', WEBTOP_USER, 'bash', '-c', `export TMPDIR=${HOME_DIR}/.tmp && export HOME=${HOME_DIR} && ${HOME_DIR}/.local/bin/claude plugin marketplace add AnEntrypoint/gm`], {
      env: { ...env, HOME: HOME_DIR },
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
