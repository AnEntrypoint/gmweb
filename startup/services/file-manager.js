import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[file-manager] Starting fsbrowse file server on port 9998...');
    return this.startFSBrowse(env);
  },

  async installFSBrowse() {
    if (existsSync('/config/node_modules/fsbrowse')) {
      console.log('[file-manager] fsbrowse already installed');
      return;
    }
    console.log('[file-manager] Installing fsbrowse...');
    try {
      execSync('cd /config && npm install fsbrowse@latest', {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000
      });
      console.log('[file-manager] fsbrowse installed successfully');
    } catch (e) {
      console.warn('[file-manager] fsbrowse installation failed, will try bunx fallback');
    }
  },

  async startFSBrowse(env) {
    await this.installFSBrowse();

    return new Promise((resolve, reject) => {
      const childEnv = { ...env, PORT: '9998', HOSTNAME: 'localhost' };

      let serverPath = '/config/node_modules/fsbrowse/server.js';
      let isUsingDirect = existsSync(serverPath);

      if (!isUsingDirect) {
        console.log('[file-manager] Using bunx fallback for fsbrowse...');
      }

      const ps = spawn('node',
        isUsingDirect ? [serverPath] : ['node_modules/fsbrowse/server.js'],
        {
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          cwd: isUsingDirect ? '/config/node_modules/fsbrowse' : '/config'
        }
      );

      let startCheckCount = 0;
      let startCheckInterval = null;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
          // Use ss to check for listening port 9998
          const { execSync: exec } = await import('child_process');
          const output = exec('ss -tln 2>/dev/null | grep ":9998"', {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            encoding: 'utf8',
            timeout: 2000
          });

          if (output && output.includes('LISTEN')) {
            clearInterval(startCheckInterval);
            console.log('[file-manager] ✓ fsbrowse responding on port 9998');
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
          } else if (startCheckCount > 120) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error('fsbrowse failed to start after 120s'));
          }
        } catch (e) {
          if (startCheckCount > 120) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error('fsbrowse failed to start after 120s'));
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
        reject(new Error(`Failed to spawn fsbrowse: ${err.message}`));
      });

      ps.on('exit', (code) => {
        clearInterval(startCheckInterval);
        if (code !== 0) {
          reject(new Error(`fsbrowse exited with code ${code}`));
        }
      });

      startCheckInterval = setInterval(checkIfStarted, 1000);
    });
  },

  async health() {
    try {
      const { execSync: exec } = await import('child_process');
      const output = exec('ss -tln 2>/dev/null | grep ":9998"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        encoding: 'utf8',
        timeout: 2000
      });
      return output && output.includes('LISTEN');
    } catch (e) {
      return false;
    }
  }
};
