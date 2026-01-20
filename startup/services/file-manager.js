// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AliSananS/NHFS
// Uses pre-built version from /opt/nhfs (built at container autostart time)
// NO FALLBACKS - waits for NHFS to be ready before starting
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const { existsSync } = await import('fs');
    
    // NHFS (Next-HTTP-File-Server) - feature-rich file manager with uploads
    // Built at container autostart in custom_startup.sh (backgrounded, non-blocking)
    // Supervisor waits for it to be ready before declaring service started
    console.log('[file-manager] Starting NHFS file server with upload support...');
    
    // Wait for NHFS to be built (poll for up to 5 minutes)
    let nhfsReady = existsSync('/opt/nhfs/dist/server.js');
    let retries = 0;
    const maxRetries = 300; // 5 minutes at 1 second intervals
    
    while (!nhfsReady && retries < maxRetries) {
      await sleep(1000);
      nhfsReady = existsSync('/opt/nhfs/dist/server.js');
      retries++;
      
      if (retries % 30 === 0) {
        console.log(`[file-manager] Waiting for NHFS build to complete (${retries}s elapsed)...`);
      }
    }
    
    if (!nhfsReady) {
      const err = new Error('NHFS build did not complete within 5 minutes');
      console.error(`[file-manager] ${err.message}`);
      throw err;
    }
    
    console.log(`[file-manager] NHFS ready, starting server...`);
    
    // Start pre-built NHFS on port 9998, serving /config directory
    // NHFS features: file uploads with drag & drop, preview, file operations
    // Use full path to node since PATH may not include NVM when spawned as service
    const nodePath = '/usr/local/local/nvm/versions/node/v23.11.1/bin/node';
    const ps = spawn('bash', ['-c', `PORT=9998 HOSTNAME=127.0.0.1 NHFS_BASE_DIR=/config ${nodePath} /opt/nhfs/dist/server.js`], {
      env: { ...env, HOME: '/config' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/opt/nhfs'
    });

    ps.stdout?.on('data', (data) => {
      console.log(`[file-manager] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[file-manager:err] ${data.toString().trim()}`);
    });

    ps.unref();
    
    // Give it a moment to start
    await sleep(2000);
    
    // Verify it started
    const isRunning = await this.health();
    if (!isRunning) {
      const err = new Error('NHFS failed to start on port 9998');
      console.error(`[file-manager] ${err.message}`);
      throw err;
    }
    
    console.log('[file-manager] ✓ NHFS started successfully on port 9998 at /files/');
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
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      // Check if port 9998 is listening
      execSync('ss -tlnp 2>/dev/null | grep -q 9998', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
