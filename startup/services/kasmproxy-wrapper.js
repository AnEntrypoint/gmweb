// KasmProxy Authentication Wrapper service
// Runs on port 80, forwards to kasmproxy on port 8080
// Selectively bypasses authentication for /files route
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'kasmproxy-wrapper',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const processEnv = {
      ...env,
      VNC_PW: env.VNC_PW || 'password',
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const ps = spawn('node', ['/opt/gmweb-startup/kasmproxy-wrapper.js'], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[kasmproxy-wrapper] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[kasmproxy-wrapper:err] ${data.toString().trim()}`);
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
