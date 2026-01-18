// File Manager service using serve
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const processEnv = {
      ...env,
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const ps = spawn('npx', ['-y', 'serve', '-l', '9998', '/home/kasm-user'], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.stdout?.on('data', (data) => {
      console.log(`[file-manager] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[file-manager:err] ${data.toString().trim()}`);
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
      execSync('lsof -i :9998 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
