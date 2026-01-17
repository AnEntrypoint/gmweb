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
    // Use npx to run webssh2-server package directly (no clone needed)
    const processEnv = {
      ...env,
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LISTEN: '0.0.0.0:9999'
    };

    const ps = spawn('bash', ['-c', `
      npx -y webssh2-server
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
