// KasmProxy service - HTTP Basic Auth reverse proxy for Webtop
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'kasmproxy',
  type: 'critical',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const processEnv = {
      ...env,
      PASSWORD: env.PASSWORD || 'password',
      LISTEN_PORT: '80',
      SUBFOLDER: env.SUBFOLDER || '/desk/',
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const ps = spawn('npx', ['-y', 'kasmproxy@latest', 'start'], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[kasmproxy] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[kasmproxy:err] ${data.toString().trim()}`);
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
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :80 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
