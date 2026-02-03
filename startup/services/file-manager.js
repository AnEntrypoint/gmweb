import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[file-manager] Starting fsbrowse on port 9998...');
    return this.startFSBrowse(env);
  },

  async startFSBrowse(env) {
    return new Promise((resolve, reject) => {
      const childEnv = { ...env, PORT: '9998', HOSTNAME: 'localhost' };

      // Try bunx first, fall back to npx if Bun is not installed
      let command = 'bunx';
      let args = ['fsbrowse@latest'];
      
      try {
        const { execSync: checkCmd } = require('child_process');
        checkCmd('which bunx', { stdio: 'pipe' });
      } catch (e) {
        console.log('[file-manager] Bun not available, using npx instead');
        command = 'npx';
        args = ['-y', 'fsbrowse@latest'];
      }

      const ps = spawn(command, args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      let startCheckCount = 0;
      let startCheckInterval = null;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
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
