import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

const NAME = 'agentgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting agentgui with bunx...`);
    
    const childEnv = {
      ...env,
      HOME: '/config',
      PORT: String(PORT)
    };

    // Start agentgui using bunx (bun's npx equivalent)
    // This spawns the process in background and returns immediately
    const ps = spawn('bash', ['-c', 'bunx agentgui'], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config'
    });

    ps.unref();
    
    // Give bunx time to download and start agentgui (up to 60 seconds)
    // Then return with the process handle
    await sleep(5000);
    
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
      // Simple check: try to connect to the port
      return await new Promise((resolve) => {
        const net = require('net');
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
      return false;
    }
  }
};
