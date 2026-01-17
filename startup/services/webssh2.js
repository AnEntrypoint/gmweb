// WebSSH2 service - web-based SSH client
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'webssh2',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Create combined environment for webssh2
    const processEnv = {
      ...env,
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      WEBSSH2_SSH_HOST: 'localhost',
      WEBSSH2_SSH_PORT: '22',
      WEBSSH2_USER_NAME: 'kasm-user',
      WEBSSH2_USER_PASSWORD: 'kasm'
    };

    const ps = spawn('bash', ['-c', `
      cd /home/kasm-user/webssh2
      npm start
    `], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[webssh2] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[webssh2:err] ${data.toString().trim()}`);
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
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    // Check if webssh2 port 9999 is listening
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :9999 | grep -q node', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
