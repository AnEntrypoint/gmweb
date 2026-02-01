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
          // Use ss to check for listening port 9998
          // Format: LISTEN 0 ... :9998 ... (ss -tln shows listening ports)
          const { execSync: exec } = await import('child_process');
          const output = exec('ss -tln 2>/dev/null | grep ":9998"', {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            encoding: 'utf8',
            timeout: 2000
          });
          
          // Verify output shows LISTEN state (not just the port existing)
          if (output && output.includes('LISTEN')) {
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
          } else if (startCheckCount > 120) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error('NHFS failed to start after 120s'));
          }
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
      const { execSync: exec } = await import('child_process');
      const output = exec('ss -tln 2>/dev/null | grep ":9998"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        encoding: 'utf8',
        timeout: 2000
      });
      // Port is healthy if ss output shows LISTEN state
      return output && output.includes('LISTEN');
    } catch (e) {
      return false;
    }
  }
};
