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
    console.log('[kasmproxy] Preparing environment...');
    console.log('[kasmproxy] PASSWORD:', env.PASSWORD ? env.PASSWORD.substring(0, 3) + '***' : '(not set)');
    console.log('[kasmproxy] SUBFOLDER:', env.SUBFOLDER);

    const processEnv = {
      ...env,
      PASSWORD: env.PASSWORD || 'password',
      LISTEN_PORT: '8080',
      SUBFOLDER: env.SUBFOLDER || '/desk/',
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      NODE_OPTIONS: '--no-warnings'
    };

    console.log('[kasmproxy] Spawning: npx -y gxe@latest AnEntrypoint/kasmproxy');
    console.log('[kasmproxy] Final PASSWORD:', processEnv.PASSWORD ? processEnv.PASSWORD.substring(0, 3) + '***' : '(not set)');

    const ps = spawn('npx', ['-y', 'gxe@latest', 'AnEntrypoint/kasmproxy'], {
      env: processEnv,
      stdio: ['ignore', 'inherit', 'inherit']
    });

    const pid = ps.pid;

    ps.on('error', (err) => {
      console.error(`[kasmproxy] Failed to spawn: ${err.message}`);
    });

    ps.on('exit', (code, signal) => {
      console.log(`[kasmproxy] Process exited with code ${code} (${signal})`);
    });

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
      execSync('lsof -i :8080 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
