// Glootie-OC OpenCode Plugin Installation/Update Service
// Install if not present, or update to latest from GitHub if already installed
// Always 1:1 with https://github.com/AnEntrypoint/glootie-oc
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';

const sleep = promisify(setTimeout);

export default {
  name: 'glootie-oc',
  type: 'install',
  requiresDesktop: false,
  dependencies: ['opencode-config'],

  async start(env) {
    const glootieDir = `${env.HOME || '/config'}/.opencode/glootie-oc`;
    const { execSync } = await import('child_process');
    
    if (existsSync(glootieDir)) {
      console.log('[glootie-oc] Updating glootie-oc from GitHub...');
      
      // Update existing installation
      return new Promise((resolve) => {
        // Fix permissions
        try {
          execSync(`sudo chown -R abc:abc "${glootieDir}" 2>/dev/null || true`);
          execSync(`sudo -u abc git config --global --add safe.directory "${glootieDir}" 2>/dev/null || true`);
        } catch (e) {
          // Ignore permission errors
        }
        
        // Pull latest from main branch
        const pullCmd = spawn('bash', ['-c', `cd "${glootieDir}" && timeout 30 git pull origin main`], {
          env: { ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false
        });

        let pullOutput = '';
        let pullError = '';

        pullCmd.stdout?.on('data', (data) => {
          pullOutput += data.toString();
        });
        pullCmd.stderr?.on('data', (data) => {
          pullError += data.toString();
        });

        pullCmd.on('exit', (code) => {
          if (code === 0) {
            console.log('[glootie-oc] ✓ Repository updated successfully');
            if (pullOutput) console.log(`[glootie-oc] ${pullOutput.trim()}`);
          } else {
            console.log(`[glootie-oc] WARNING: Git pull exited with code ${code}`);
            if (pullError) console.log(`[glootie-oc] ${pullError.trim()}`);
          }

          // Check if setup.sh exists before running it
          const setupPath = join(glootieDir, 'setup.sh');
          if (!existsSync(setupPath)) {
            console.log('[glootie-oc] setup.sh not found, skipping setup');
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
            return;
          }

          // Run setup.sh to apply any changes
          const setupCmd = spawn('bash', ['./setup.sh'], {
            env: { ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            cwd: glootieDir
          });

          let setupOutput = '';
          let setupError = '';

          setupCmd.stdout?.on('data', (data) => {
            setupOutput += data.toString();
            console.log(`[glootie-oc] ${data.toString().trim()}`);
          });
          setupCmd.stderr?.on('data', (data) => {
            setupError += data.toString();
            console.log(`[glootie-oc:err] ${data.toString().trim()}`);
          });

          setupCmd.on('exit', (setupCode) => {
            if (setupCode === 0) {
              console.log('[glootie-oc] ✓ Setup completed successfully');
            } else {
              console.log(`[glootie-oc] WARNING: Setup exited with code ${setupCode}`);
              if (setupError) console.log(`[glootie-oc] Setup stderr: ${setupError.trim()}`);
            }
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
          });
        });
      });
    } else {
      console.log('[glootie-oc] Installing glootie-oc from GitHub...');
      
      // Clone new installation
      const cloneCmd = spawn('git', [
        'clone',
        'https://github.com/AnEntrypoint/glootie-oc.git',
        glootieDir
      ], {
        env: { ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: env.HOME || '/config'
      });

      return new Promise((resolve) => {
        let cloneOutput = '';
        let cloneError = '';

        cloneCmd.stdout?.on('data', (data) => {
          cloneOutput += data.toString();
        });
        cloneCmd.stderr?.on('data', (data) => {
          cloneError += data.toString();
        });

        cloneCmd.on('exit', (code) => {
          if (code === 0) {
            console.log('[glootie-oc] ✓ Repository cloned successfully');
            if (cloneOutput) console.log(`[glootie-oc] ${cloneOutput.trim()}`);
          } else {
            console.log(`[glootie-oc] ERROR: Git clone failed with code ${code}`);
            if (cloneError) console.log(`[glootie-oc] ${cloneError.trim()}`);
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
            return;
          }

          // Check if setup.sh exists before running it
          const setupPath = join(glootieDir, 'setup.sh');
          if (!existsSync(setupPath)) {
            console.log('[glootie-oc] setup.sh not found, skipping setup');
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
            return;
          }

          // Run setup.sh
          const setupCmd = spawn('bash', ['./setup.sh'], {
            env: { ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            cwd: glootieDir
          });

          let setupOutput = '';
          let setupError = '';

          setupCmd.stdout?.on('data', (data) => {
            setupOutput += data.toString();
            console.log(`[glootie-oc] ${data.toString().trim()}`);
          });
          setupCmd.stderr?.on('data', (data) => {
            setupError += data.toString();
            console.log(`[glootie-oc:err] ${data.toString().trim()}`);
          });

          setupCmd.on('exit', (setupCode) => {
            if (setupCode === 0) {
              console.log('[glootie-oc] ✓ Setup completed successfully');
            } else {
              console.log(`[glootie-oc] WARNING: Setup exited with code ${setupCode}`);
              if (setupError) console.log(`[glootie-oc] Setup stderr: ${setupError.trim()}`);
            }
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
          });
        });
      });
    }
  },

  async health() {
    // Always healthy - this is an install service
    return true;
  }
};
