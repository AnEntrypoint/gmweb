import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const sleep = promisify(setTimeout);

const NAME = 'gmgui';
const PORT = 9897;

// Utility to find gxe extraction directory
function findGxeDir(repoUrl) {
  const gxeBaseDir = path.join(process.env.HOME || '/config', '.gxe');
  if (!fs.existsSync(gxeBaseDir)) return null;
  
  try {
    const entries = fs.readdirSync(gxeBaseDir);
    for (const entry of entries) {
      const dirPath = path.join(gxeBaseDir, entry);
      const stat = fs.statSync(dirPath);
      if (stat.isDirectory()) {
        const pkgPath = path.join(dirPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          return dirPath;
        }
      }
    }
  } catch (e) {
    console.error(`[${NAME}] Error finding gxe dir:`, e.message);
  }
  return null;
}

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service via gxe...`);
    return new Promise((resolve, reject) => {
      try {
        execSync('git config --global --add safe.directory "*"', { stdio: 'pipe' });
      } catch (e) {}

      const childEnv = { ...env, HOME: '/config', PORT: String(PORT) };
      let gxeDirPath = null;

      const ps = spawn('npx', ['-y', 'gxe@latest', 'AnEntrypoint/gmgui'], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: '/config'
      });

      let startCheckCount = 0;
      let startCheckInterval = null;
      let npmInstallDone = false;

      const checkIfStarted = async () => {
        startCheckCount++;
        try {
          const { execSync: exec } = await import('child_process');
          
          // First, try to find and install npm deps if not done
          if (!npmInstallDone && startCheckCount === 5) {
            gxeDirPath = findGxeDir('AnEntrypoint/gmgui');
            if (gxeDirPath) {
              console.log(`[${NAME}] Found gxe extraction at ${gxeDirPath}`);
              try {
                console.log(`[${NAME}] Running npm install...`);
                execSync('npm install --legacy-peer-deps', {
                  cwd: gxeDirPath,
                  stdio: ['ignore', 'pipe', 'pipe'],
                  timeout: 60000
                });
                console.log(`[${NAME}] npm install completed`);
                npmInstallDone = true;
              } catch (e) {
                console.log(`[${NAME}] npm install error: ${e.message}`);
              }
            }
          }
          
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
