// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AliSananS/NHFS
// Uses pre-built version from /opt/nhfs (built at container autostart time)
// Strategy: Start lightweight server immediately for fast boot, auto-upgrade to NHFS when ready
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
    
    console.log('[file-manager] Starting file server...');
    
    // Try NHFS immediately (if already built from previous boot)
    const nhfsReady = existsSync('/opt/nhfs/dist/server.js');
    
    if (nhfsReady) {
      console.log('[file-manager] NHFS detected, starting NHFS server with upload support...');
      
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
      if (isRunning) {
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
      } else {
        console.log('[file-manager] NHFS failed to start, falling back to lightweight server');
      }
    } else {
      console.log('[file-manager] NHFS not ready yet, starting lightweight file server (will auto-upgrade when NHFS ready)');
    }
    
    // Fallback: Start lightweight standalone file server for fast boot
    console.log('[file-manager] Starting lightweight file server on port 9998...');
    
    const processEnv = {
      ...env,
      BASE_DIR: '/config',
      PORT: '9998',
      HOSTNAME: '0.0.0.0'
    };

    const ps = spawn('node', ['/opt/gmweb-startup/standalone-server.mjs'], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.stdout?.on('data', (data) => {
      console.log(`[file-manager] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[file-manager:err] ${data.toString().trim()}`);
    });

    ps.unref();
    
    // Spawn NHFS build watcher in background to auto-upgrade when ready
    // This doesn't block startup - just runs in background
    this.watchNHFSBuild();
    
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  // Watch for NHFS build completion and auto-upgrade in background
  async watchNHFSBuild() {
    const { existsSync, watch } = await import('fs');
    
    console.log('[file-manager] Watching for NHFS build to complete...');
    
    // Poll for NHFS to be ready (up to 10 minutes in background)
    let retries = 0;
    const maxRetries = 600; // 10 minutes
    
    while (retries < maxRetries) {
      await sleep(1000);
      retries++;
      
      if (existsSync('/opt/nhfs/dist/server.js')) {
        console.log(`[file-manager] NHFS build complete! (${retries}s). Upgrading from lightweight to NHFS server...`);
        
        // Kill lightweight server and start NHFS
        try {
          const { execSync } = await import('child_process');
          
          // Kill lightweight server on port 9998
          execSync('lsof -ti:9998 | xargs -r kill -9 2>/dev/null || true');
          await sleep(1000);
          
          // Start NHFS
          const nodePath = '/usr/local/local/nvm/versions/node/v23.11.1/bin/node';
          const nhfsPs = spawn('bash', ['-c', `PORT=9998 HOSTNAME=127.0.0.1 NHFS_BASE_DIR=/config ${nodePath} /opt/nhfs/dist/server.js`], {
            env: { HOME: '/config' },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
            cwd: '/opt/nhfs'
          });

          nhfsPs.stdout?.on('data', (data) => {
            console.log(`[file-manager-nhfs] ${data.toString().trim()}`);
          });
          nhfsPs.stderr?.on('data', (data) => {
            console.log(`[file-manager-nhfs:err] ${data.toString().trim()}`);
          });

          nhfsPs.unref();
          console.log('[file-manager] ✓ Upgraded to NHFS successfully!');
        } catch (e) {
          console.log('[file-manager] Warning: Could not upgrade to NHFS:', e.message);
        }
        
        break; // Stop watching
      }
      
      if (retries % 60 === 0) {
        console.log(`[file-manager] Still waiting for NHFS build... (${retries}s elapsed)`);
      }
    }
    
    if (retries >= maxRetries) {
      console.log('[file-manager] NHFS build did not complete within 10 minutes, staying with lightweight server');
    }
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
