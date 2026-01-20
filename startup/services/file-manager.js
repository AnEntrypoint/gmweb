// NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
// GitHub: https://github.com/AliSananS/NHFS
// Uses pre-built version from /opt/nhfs (built at Docker build time)
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'file-manager',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[file-manager] Starting NHFS file server with upload support...');
    
    try {
      // Start pre-built NHFS on port 9998, serving /config directory
      // NHFS features: file uploads with drag & drop, preview, file operations
      // Uses dist/server.js from /opt/nhfs (built at Docker image time)
      const ps = spawn('bash', ['-c', 'PORT=9998 HOSTNAME=127.0.0.1 NHFS_BASE_DIR=/config node /opt/nhfs/dist/server.js'], {
        env: { ...env, HOME: '/config' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        cwd: '/opt/nhfs'
      });

      ps.unref();
      
      // Give it a moment to start
      await sleep(3000);
      
      // Verify it started
      const isRunning = await this.health();
      if (!isRunning) {
        console.log('[file-manager] Warning: Server may not have started successfully');
      } else {
        console.log('[file-manager] ✓ NHFS started successfully on port 9998 at /files/');
      }
      
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
    } catch (err) {
      console.log('[file-manager] Error starting NHFS:', err.message);
      return { pid: 0, process: null, cleanup: async () => {} };
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
