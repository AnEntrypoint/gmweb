// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AliSananS/NHFS
// Uses pre-built version from /opt/nhfs (built at container autostart time)
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
    
    // Try to start NHFS first (feature-rich file manager with uploads)
    const nhfsReady = existsSync('/opt/nhfs/dist/server.js');
    
    if (nhfsReady) {
      console.log('[file-manager] Starting NHFS file server with upload support...');
      
      try {
        // Start pre-built NHFS on port 9998, serving /config directory
        // NHFS features: file uploads with drag & drop, preview, file operations
        // Built at container autostart in custom_startup.sh (may still be building)
        const ps = spawn('bash', ['-c', 'PORT=9998 HOSTNAME=127.0.0.1 NHFS_BASE_DIR=/config node /opt/nhfs/dist/server.js'], {
          env: { ...env, HOME: '/config' },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          cwd: '/opt/nhfs'
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
      } catch (err) {
        console.log('[file-manager] Error starting NHFS:', err.message, '- falling back to lightweight server');
      }
    } else {
      console.log('[file-manager] NHFS not ready yet, using lightweight file server (will auto-upgrade when NHFS ready)');
    }
    
    // Fallback: Start lightweight standalone file server
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
