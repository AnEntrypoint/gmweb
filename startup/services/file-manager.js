// File Manager service using NHFS (Next.js HTTP File Server)
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
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      NODE_ENV: 'production'
    };

    // Run NHFS via npx (Next.js HTTP File Server)
    // https://github.com/AliSananS/NHFS
    const ps = spawn('npx', ['-y', 'nhfs', '--port', '9998', '--dir', '/config'], {
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
      const http = await import('http');
      return new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 9998,
          path: '/',
          method: 'GET',
          timeout: 2000
        }, (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 500);
          res.resume(); // Drain the response
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });
    } catch (e) {
      return false;
    }
  }
};
