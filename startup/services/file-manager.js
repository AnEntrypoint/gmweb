// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AliSananS/NHFS
// NO FALLBACKS - Only NHFS. Service returns immediately, NHFS starts when ready (up to 5 min).
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
    
    console.log('[file-manager] Starting NHFS file server (waiting for build)...');
    
    // Check if NHFS is already built from previous boot
    const nhfsReady = existsSync('/opt/nhfs/dist/server.js');
    
    if (nhfsReady) {
      console.log('[file-manager] NHFS detected, starting immediately...');
      return this.startNHFS(env);
    } else {
      console.log('[file-manager] NHFS not ready yet, spawning build watcher...');
      // Spawn NHFS build watcher in background, don't wait for it
      this.watchNHFSBuild(env);
      
      // Return a placeholder process that will be replaced when NHFS is ready
      return {
        pid: process.pid,
        process: null,
        cleanup: async () => {}
      };
    }
  },

  async startNHFS(env) {
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
    
    await sleep(2000);
    
    const isRunning = await this.health();
    if (isRunning) {
      console.log('[file-manager] ✓ NHFS started successfully on port 9998');
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
    } else {
      const err = new Error('NHFS failed to start');
      console.error(`[file-manager] ${err.message}`);
      throw err;
    }
  },

  // Watch for NHFS build completion and start it
  async watchNHFSBuild(env) {
    const { existsSync } = await import('fs');
    
    console.log('[file-manager] Watching for NHFS build to complete (max 5 min)...');
    
    // Poll for NHFS to be ready (up to 5 minutes)
    let retries = 0;
    const maxRetries = 300; // 5 minutes
    
    while (retries < maxRetries) {
      await sleep(1000);
      retries++;
      
      if (existsSync('/opt/nhfs/dist/server.js')) {
        console.log(`[file-manager] NHFS build complete! (${retries}s). Starting NHFS server...`);
        
        try {
          await this.startNHFS(env);
        } catch (e) {
          console.error('[file-manager] Error starting NHFS:', e.message);
        }
        
        break; // Stop watching
      }
      
      if (retries % 60 === 0) {
        console.log(`[file-manager] Still waiting for NHFS build... (${retries}s elapsed)`);
      }
    }
    
    if (retries >= maxRetries) {
      console.error('[file-manager] NHFS build did not complete within 5 minutes');
    }
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('ss -tlnp 2>/dev/null | grep -q 9998', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
