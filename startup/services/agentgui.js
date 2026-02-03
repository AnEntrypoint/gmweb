import { spawn, execSync } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

const NAME = 'agentgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting agentgui with bunx...`);
    
    const childEnv = {
      ...env,
      HOME: '/config',
      PORT: String(PORT)
    };

    // Start agentgui using bunx (bun's npx equivalent)
    const ps = spawn('bunx', ['agentgui'], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config'
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
          ps.unref();
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
        } else if (startCheckCount > 180) {
          clearInterval(startCheckInterval);
          process.kill(-ps.pid, 'SIGKILL');
          throw new Error(`${NAME} failed to start after 180s`);
        }
      } catch (e) {
        if (startCheckCount > 180) {
          clearInterval(startCheckInterval);
          try {
            process.kill(-ps.pid, 'SIGKILL');
          } catch (err) {}
          throw new Error(`${NAME} failed to start after 180s`);
        }
      }
    };

    return new Promise((resolve, reject) => {
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

      // Check every 1 second if port is listening
      startCheckInterval = setInterval(async () => {
        try {
          const result = await checkIfStarted();
          if (result) {
            resolved = true;
            resolve(result);
          }
        } catch (e) {
          clearInterval(startCheckInterval);
          reject(e);
        }
      }, 1000);
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
