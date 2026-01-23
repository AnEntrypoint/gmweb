// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AnEntrypoint/nhfs
// Uses gxe to run NHFS directly from GitHub repository
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[file-manager] Starting NHFS file server via gxe...');
    return this.startNHFS(env);
  },

  async startNHFS(env) {
    const ps = spawn('bash', ['-c', 'PORT=9998 BASEPATH=/files npx -y gxe@latest AnEntrypoint/nhfs'], {
      env: { ...env, HOME: '/config', BASE_DIR: '/config' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config'
    });

    ps.stdout?.on('data', (data) => {
      console.log(`[file-manager] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[file-manager:err] ${data.toString().trim()}`);
    });

    ps.unref();

    await sleep(3000);

    const isRunning = await this.health();
    if (isRunning) {
      console.log('[file-manager] ✓ NHFS started successfully on port 9998');
      return {
        pid: ps.pid,
        process: ps,
        cleanup: async () => {
          try {
            process.kill(-ps.pid, 'SIGTERM');
            await sleep(1000);
            process.kill(-ps.pid, 'SIGKILL');
          } catch (e) {}
        }
      };
    } else {
      const err = new Error('NHFS failed to start');
      console.error(`[file-manager] ${err.message}`);
      throw err;
    }
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('ss -tlnp 2>/dev/null | grep -q 9998', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
