import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const sleep = promisify(setTimeout);

const NAME = 'gmgui';
const PORT = 9897;
const INSTALL_DIR = '/tmp/gmgui-install';

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service via curl install script...`);
    return new Promise((resolve, reject) => {
      try {
        if (!fs.existsSync(INSTALL_DIR)) {
          fs.mkdirSync(INSTALL_DIR, { recursive: true });
        }
      } catch (e) {
        console.error(`[${NAME}] Failed to create install directory: ${e.message}`);
      }

      const childEnv = { ...env, HOME: '/config', PORT: String(PORT) };

      const ps = spawn('bash', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmgui/main/install.sh | bash'], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: INSTALL_DIR
      });

      let startCheckCount = 0;
      let startCheckInterval = null;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
          const { execSync: exec } = await import('child_process');

          const output = exec(`ss -tln 2>/dev/null | grep :${PORT}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            encoding: 'utf8',
            timeout: 2000
          });

          if (output && output.includes('LISTEN')) {
            clearInterval(startCheckInterval);
            console.log(`[${NAME}] ✓ Service responding on port ${PORT}`);
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
          } else if (startCheckCount > 180) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error(`${NAME} failed to start after 180s`));
          }
        } catch (e) {
          if (startCheckCount > 180) {
            clearInterval(startCheckInterval);
            ps.kill('SIGKILL');
            reject(new Error(`${NAME} failed to start after 180s`));
          }
        }
      };

      ps.stdout?.on('data', (data) => {
        console.log(`[${NAME}] ${data.toString().trim()}`);
      });

      ps.stderr?.on('data', (data) => {
        console.log(`[${NAME}:err] ${data.toString().trim()}`);
      });

      ps.on('error', (err) => {
        clearInterval(startCheckInterval);
        reject(new Error(`Failed to spawn ${NAME}: ${err.message}`));
      });

      ps.on('exit', (code) => {
        clearInterval(startCheckInterval);
        if (code !== 0) {
          reject(new Error(`${NAME} exited with code ${code}`));
        }
      });

      startCheckInterval = setInterval(checkIfStarted, 1000);
    });
  },

  async health() {
    try {
      const { execSync: exec } = await import('child_process');
      const output = exec(`ss -tln 2>/dev/null | grep :${PORT}`, {
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
