// Glootie-OC OpenCode Plugin Installation/Update Service
// Installs to ~/.config/opencode/plugin (global installation)
// Reference: https://github.com/AnEntrypoint/glootie-oc
import { spawn, execSync } from 'child_process';
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
    const homeDir = env.HOME || '/config';
    const glootieDir = `${homeDir}/.config/opencode/plugin`;
    
    if (existsSync(glootieDir)) {
      console.log('[glootie-oc] Updating glootie-oc from GitHub...');
      
      return new Promise((resolve) => {
        try {
          execSync(`sudo chown -R abc:abc "${glootieDir}" 2>/dev/null || true`);
          execSync(`sudo -u abc git config --global --add safe.directory "${glootieDir}" 2>/dev/null || true`);
        } catch (e) {}
        
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

          this.installDeps(glootieDir, env, resolve);
        });
      });
    } else {
      console.log('[glootie-oc] Installing glootie-oc from GitHub...');
      
      const cloneCmd = spawn('git', [
        'clone',
        'https://github.com/AnEntrypoint/glootie-oc.git',
        glootieDir
      ], {
        env: { ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: `${homeDir}/.config/opencode`
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

          this.installDeps(glootieDir, env, resolve);
        });
      });
    }
  },

  installDeps(glootieDir, env, resolve) {
    if (existsSync(join(glootieDir, 'package.json'))) {
      console.log('[glootie-oc] Installing plugin dependencies...');
      try {
        execSync(`cd "${glootieDir}" && bun install 2>&1 || npm install 2>&1`, {
          timeout: 120000,
          stdio: 'pipe',
          env: { ...process.env, ...env }
        });
        console.log('[glootie-oc] ✓ Dependencies installed');
      } catch (e) {
        console.log(`[glootie-oc] Warning: Could not install dependencies: ${e.message}`);
      }
    }

    try {
      execSync(`sudo chown -R abc:abc "${glootieDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {}

    resolve({
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    });
  },

  async health() {
    return true;
  }
};
