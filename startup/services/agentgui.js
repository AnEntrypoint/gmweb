import { spawn, execSync } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const sleep = promisify(setTimeout);

const NAME = 'agentgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting agentgui@latest with bunx...`);
    
    const childEnv = {
      ...env,
      HOME: '/config',
      PORT: String(PORT)
    };

    // CRITICAL: Clear bunx cache to ensure latest version is downloaded
    try {
      const tmpDir = '/config/.tmp/bunx-*-agentgui@latest';
      execSync(`rm -rf ${tmpDir} 2>/dev/null || true`, { stdio: 'pipe' });
      console.log(`[${NAME}] Cleared old bunx cache to ensure latest version`);
    } catch (e) {
      console.log(`[${NAME}] Warning: Could not clear bunx cache: ${e.message}`);
    }

    // Start agentgui@latest using bunx with --latest flag to ensure fresh download
    // This spawns the process in background and returns immediately
    const ps = spawn('bash', ['-c', `PORT=${PORT} bunx --latest agentgui@latest`], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config'
    });

    ps.unref();
    
    // Give bunx time to download and start agentgui (allow up to 30 seconds)
    // Then return with the process handle
    await sleep(10000);
    
    console.log(`[${NAME}] ✓ Service started in background (PID: ${ps.pid})`);
    
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
       // Check if agentgui is listening on the correct port
       return await new Promise((resolve) => {
         const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          resolve(false);
        });
        socket.connect(PORT, 'localhost');
      });
    } catch (e) {
      console.log(`[${NAME}] Health check error: ${e.message}`);
      return false;
    }
  }
};
