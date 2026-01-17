// Wrangler installation service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'wrangler',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Use full path to npm since sudo doesn't inherit NVM PATH
    const npmPath = '/usr/local/local/nvm/versions/node/v23.11.1/bin/npm';
    const ps = spawn('bash', ['-c', `${npmPath} install -g wrangler`], {
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
      execSync('which wrangler', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
