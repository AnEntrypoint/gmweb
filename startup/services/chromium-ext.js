// Chromium Extension enablement service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'chromium-ext',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    try {
      console.log('[chromium-ext] Running extension enablement script...');
      
      // Run the enable_chromium_extension.py script to enable the PlaywrightGMWeb extension
      const ps = spawn('python3', ['/usr/local/bin/enable_chromium_extension.py'], {
        env: { ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      // Wait for process to complete (should be quick)
      await new Promise((resolve, reject) => {
        ps.on('exit', (code) => {
          if (code === 0 || code === null) {
            console.log('[chromium-ext] Extension enablement completed successfully');
            resolve();
          } else {
            console.log(`[chromium-ext] Extension enablement exited with code ${code}`);
            resolve(); // Don't reject - this is optional
          }
        });
        ps.on('error', (err) => {
          console.log(`[chromium-ext] Error running enablement script: ${err.message}`);
          resolve(); // Don't reject - script might not exist yet
        });
      });

      return {
        pid: process.pid,
        process: null,
        cleanup: async () => {}
      };
    } catch (err) {
      console.log(`[chromium-ext] Error: ${err.message}`);
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
