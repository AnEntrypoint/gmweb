import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';

const sleep = promisify(setTimeout);

const NAME = 'agentgui';
const PORT = 9897;
const INSTALL_DIR = '/tmp/agentgui-install';

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service via GitHub agentgui...`);
    return new Promise((resolve, reject) => {
      try {
        if (!existsSync(INSTALL_DIR)) {
          mkdirSync(INSTALL_DIR, { recursive: true });
        }
      } catch (e) {
        console.error(`[${NAME}] Failed to create install directory: ${e.message}`);
      }

      const childEnv = { ...env, HOME: '/config', PORT: String(PORT) };

      const ps = spawn('bash', ['-c', 'curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/agentgui/main/install.sh | bash'], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: INSTALL_DIR
      });

      let startCheckCount = 0;
      let startCheckInterval = null;
      let resolved = false;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
          const output = execSync(`ss -tln 2>/dev/null | grep :${PORT}`, {
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
      const output = execSync(`ss -tln 2>/dev/null | grep :${PORT}`, {
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
