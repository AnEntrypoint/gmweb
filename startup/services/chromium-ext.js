// Chromium Extension enablement service
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'chromium-ext',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    try {
      console.log('[chromium-ext] Checking Chromium prerequisites...');
      
      // Pre-flight checks
      const checks = [
        { path: '/usr/bin/chromium', name: 'Chromium wrapper', required: true },
        { path: '/usr/bin/python3', name: 'Python 3', required: true },
        { path: '/usr/local/bin/enable_chromium_extension.py', name: 'Extension enabler script', required: true },
        { path: '/etc/chromium/policies/managed/extension_install_forcelist.json', name: 'Extension policy', required: true }
      ];

      const missing = checks.filter(c => c.required && !existsSync(c.path));
      if (missing.length > 0) {
        console.log(`[chromium-ext] WARNING: Missing prerequisites:`);
        missing.forEach(m => console.log(`  - ${m.name} at ${m.path}`));
        console.log('[chromium-ext] Chromium will be unavailable at startup');
        return {
          pid: process.pid,
          process: null,
          cleanup: async () => {}
        };
      }

      // Check for actual chromium binary (could be chromium-browser or chromium.real)
      const hasChromiumBinary = existsSync('/usr/bin/chromium-browser') || existsSync('/usr/bin/chromium.real');
      if (!hasChromiumBinary) {
        console.log('[chromium-ext] WARNING: No chromium binary found (neither chromium-browser nor chromium.real)');
        console.log('[chromium-ext] Chromium will be unavailable');
        return {
          pid: process.pid,
          process: null,
          cleanup: async () => {}
        };
      }

      console.log('[chromium-ext] All prerequisites found. Running extension enablement...');
      
      // Run the enable_chromium_extension.py script to enable the PlaywrightGMWeb extension
      const ps = spawn('python3', ['/usr/local/bin/enable_chromium_extension.py'], {
        env: { ...env },
        stdio: 'pipe',
        detached: false
      });

      let stdout = '';
      let stderr = '';

      ps.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      ps.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for process to complete (should be quick, timeout at 5s)
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[chromium-ext] WARNING: Enablement script timeout after 5s, assuming success');
          ps.kill('SIGTERM');
          resolve();
        }, 5000);

        ps.on('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 || code === null) {
            console.log('[chromium-ext] Extension enablement completed successfully');
            if (stdout.trim()) console.log(`[chromium-ext] Output: ${stdout.trim()}`);
          } else {
            console.log(`[chromium-ext] Extension enablement exited with code ${code}`);
            if (stderr.trim()) console.log(`[chromium-ext] Error output: ${stderr.trim()}`);
          }
          resolve();
        });

        ps.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`[chromium-ext] Failed to run enablement script: ${err.message}`);
          resolve();
        });
      });

      return {
        pid: process.pid,
        process: null,
        cleanup: async () => {}
      };
    } catch (err) {
      console.log(`[chromium-ext] Unexpected error: ${err.message}`);
      return {
        pid: process.pid,
        process: null,
        cleanup: async () => {}
      };
    }
  },

  async health() {
    // Always healthy - this service is a one-time setup task
    return true;
  }
};
