// Playwriter MCP relay server - maintains WebSocket connection for Playwriter extension
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const WEBTOP_USER = process.env.SUDO_USER || 'abc';

export default {
  name: 'playwriter',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[playwriter] Starting Playwriter relay server...');
    
    try {
      // Start playwriter-ws-server in background
      const ps = spawn('bash', ['-c', `
        cd /tmp
        export HOME=/config
        exec playwriter-ws-server
      `], {
        env: { ...env, HOME: '/config' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });

      ps.unref();
      
      // Give it a moment to start
      await sleep(2000);
      
      // Verify it started
      const isRunning = await this.health();
      if (!isRunning) {
        console.log('[playwriter] Warning: Server may not have started successfully');
      } else {
        console.log('[playwriter] ✓ Relay server started successfully on port 19988');
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
      console.log('[playwriter] Error starting relay server:', err.message);
      return { pid: 0, process: null, cleanup: async () => {} };
    }
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      // Check if port 19988 is listening
      execSync('ss -tlnp 2>/dev/null | grep -q 19988', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
