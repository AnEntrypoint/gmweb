// Glootie-OC OpenCode Plugin Installation Service
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'glootie-oc',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const glootieDir = `${env.HOME || '/config'}/.opencode/glootie-oc`;
    
    console.log('[glootie-oc] Checking glootie-oc installation...');
    
    if (existsSync(glootieDir)) {
      console.log('[glootie-oc] glootie-oc already installed at', glootieDir);
      return {
        pid: process.pid,
        process: null,
        cleanup: async () => {}
      };
    }

    console.log('[glootie-oc] Installing glootie-oc from GitHub...');
    
    // Clone glootie-oc repository
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
      cloneCmd.on('exit', (code) => {
        if (code === 0) {
          console.log('[glootie-oc] ✓ Repository cloned successfully');
          
          // Run setup.sh
          const setupCmd = spawn('bash', ['./setup.sh'], {
            env: { ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            cwd: glootieDir
          });

          setupCmd.stdout?.on('data', (data) => {
            console.log(`[glootie-oc] ${data.toString().trim()}`);
          });
          setupCmd.stderr?.on('data', (data) => {
            console.log(`[glootie-oc:err] ${data.toString().trim()}`);
          });

          setupCmd.on('exit', (setupCode) => {
            if (setupCode === 0) {
              console.log('[glootie-oc] ✓ Setup completed successfully');
            } else {
              console.log(`[glootie-oc] WARNING: Setup exited with code ${setupCode}`);
            }
            resolve({
              pid: process.pid,
              process: null,
              cleanup: async () => {}
            });
          });
        } else {
          console.log(`[glootie-oc] ERROR: Git clone failed with code ${code}`);
          resolve({
            pid: process.pid,
            process: null,
            cleanup: async () => {}
          });
        }
      });
    });
  },

  async health() {
    // Always healthy - this is an install service
    return true;
  }
};
