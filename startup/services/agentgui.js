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
    console.log(`[${NAME}] Starting agentgui from local repository...`);

    const childEnv = {
      ...env,
      HOME: '/config',
      PORT: String(PORT),
      BASE_URL: '/gm',  // agentgui connects to itself via this base path
      HOT_RELOAD: 'false',  // Disable hot reload in production
      NODE_ENV: 'production'
    };

    // Start agentgui from the local git repository at /config/workspace/agentgui
    // This ensures we always run the latest code from the repo
    const ps = spawn('node', ['server.js'], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config/workspace/agentgui'
    });

    ps.unref();

    // Give node time to start the server
    await sleep(3000);

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
