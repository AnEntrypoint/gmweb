import { spawn, execSync } from 'child_process';
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
    return new Promise((resolve, reject) => {
      try {
        execSync('git config --global --add safe.directory "*"', { stdio: 'pipe' });
      } catch (e) {}

      const childEnv = { ...env, HOME: '/config', BASE_DIR: '/config', PORT: '9998', BASEPATH: '/files' };

      const ps = spawn('npx', ['-y', 'gxe@latest', 'AnEntrypoint/nhfs'], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: '/config'
      });

      let startCheckCount = 0;
      let startCheckInterval = null;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
          execSync('ss -tuln 2>/dev/null | grep -q :9998 || netstat -tuln 2>/dev/null | grep -q :9998', { stdio: 'pipe' });
          clearInterval(startCheckInterval);
          console.log('[file-manager] ✓ NHFS responding on port 9998');
          resolve({
            pid: ps.pid,
            process: ps,
            cleanup: async () => {
              try {
                ps.kill('SIGTERM');
                await sleep(1000);
                ps.kill('SIGKILL');
              } catch (e) {}
            }
          });
        } catch (e) {
          if (startCheckCount > 120) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error('NHFS failed to start after 120s'));
          }
        }
      };

      ps.stdout?.on('data', (data) => {
        console.log(`[file-manager] ${data.toString().trim()}`);
      });

      ps.stderr?.on('data', (data) => {
        console.log(`[file-manager:err] ${data.toString().trim()}`);
      });

      ps.on('error', (err) => {
        clearInterval(startCheckInterval);
        reject(new Error(`Failed to spawn NHFS: ${err.message}`));
      });

      ps.on('exit', (code) => {
        clearInterval(startCheckInterval);
        if (code !== 0) {
          reject(new Error(`NHFS exited with code ${code}`));
        }
      });

      startCheckInterval = setInterval(checkIfStarted, 1000);
    });
  },

  async health() {
    try {
      execSync('ss -tuln 2>/dev/null | grep -q :9998 || netstat -tuln 2>/dev/null | grep -q :9998', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
