import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

const NAME = 'gmgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service via agentgui server.js...`);
    return new Promise((resolve, reject) => {
      const childEnv = {
        ...env,
        HOME: '/tmp',
        PORT: String(PORT),
        BASE_URL: '/gm'
      };

      // Directly spawn server.js instead of going through bunx wrapper
      // The bunx -> gmgui.cjs -> server.js chain has stdio issues
      const serverPath = '/config/.tmp/bunx-1000-agentgui@latest/node_modules/agentgui/server.js';

      const ps = spawn('node', [serverPath], {
        env: childEnv,
        stdio: 'inherit',
        detached: false,
        shell: false
      });

      let startCheckCount = 0;
      let startCheckInterval = null;
      let resolved = false;

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
            resolved = true;
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

      ps.on('error', (err) => {
        clearInterval(startCheckInterval);
        if (!resolved) {
          reject(new Error(`Failed to spawn ${NAME}: ${err.message}`));
        }
      });

      ps.on('exit', (code) => {
        clearInterval(startCheckInterval);
        if (code !== 0 && !resolved) {
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
