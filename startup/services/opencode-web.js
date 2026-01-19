// OpenCode Web Editor Service
// Starts the OpenCode web interface on port 9997
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'opencode-web',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Use the opencode binary from home directory
    const opencodeBinary = `${env.HOME || '/config'}/.opencode/bin/opencode`;

    // Check if opencode binary exists
    if (!existsSync(opencodeBinary)) {
      console.log('[opencode-web] opencode binary not found at', opencodeBinary);
      return {
        pid: null,
        process: null,
        cleanup: async () => {}
      };
    }

    console.log('[opencode-web] Starting OpenCode web on port 9997');

    // Start opencode web service with password from PASSWORD env var
    const ps = spawn(opencodeBinary, ['web', '--port', '9997', '--hostname', '127.0.0.1', '--print-logs'], {
      env: { 
        ...env,
        OPENCODE_SERVER_PASSWORD: env.PASSWORD || 'default'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[opencode-web] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[opencode-web:err] ${data.toString().trim()}`);
    });

    ps.unref();

    return {
      pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-pid, 'SIGKILL');
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    try {
      // Try to connect to the port
      const net = await import('net');
      return await new Promise((resolve) => {
        const socket = net.createConnection({ port: 9997, host: '127.0.0.1' });
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          resolve(false);
        });
        socket.setTimeout(2000, () => {
          socket.destroy();
          resolve(false);
        });
      });
    } catch (e) {
      return false;
    }
  }
};
