// Node File Manager service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Create combined environment for file-manager
    const processEnv = {
      ...env,
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PORT: '9998'
    };

    const ps = spawn('bash', ['-c', `
      cd /home/kasm-user/node-file-manager-esm
      npm start -- -d /home/kasm-user/Desktop
    `], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.unref();
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :9998 | grep -q node', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
