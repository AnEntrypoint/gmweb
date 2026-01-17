// KasmProxy service - web proxy for Kasm desktop
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'kasmproxy',
  type: 'critical',
  requiresDesktop: true,
  dependencies: [],

  async start(env) {
    // Create combined environment for kasmproxy
    const processEnv = {
      ...env,
      VNC_PW: env.VNC_PW || 'password',
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const ps = spawn('bash', ['-c', `
      export VNC_PW="$VNC_PW"
      export PATH="$PATH"
      npx -y gxe@latest AnEntrypoint/kasmproxy start
    `], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    // Log output
    ps.stdout?.on('data', (data) => {
      console.log(`[kasmproxy] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[kasmproxy:err] ${data.toString().trim()}`);
    });

    // Unref so it doesn't block parent
    ps.unref();

    return {
      pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-pid, 'SIGKILL');
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    // Check if kasmproxy process is running and port 8000 is open
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :8000 | grep -q kasmproxy', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
