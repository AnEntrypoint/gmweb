// OpenCode Web Editor Service
// Starts the OpenCode web interface on port 9997
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { execSync } from 'child_process';

const sleep = promisify(setTimeout);

export default {
  name: 'opencode-web',
  type: 'web',
  requiresDesktop: false,
  dependencies: ['glootie-oc'], // Wait for glootie-oc to be installed first

  async start(env) {
    // Use the opencode binary from NVM path (created by opencode service)
    const opencodeBinary = '/usr/local/local/nvm/versions/node/v23.11.1/bin/opencode';
    const homeDir = '/config';
    const opencodeUserDir = `${homeDir}/.opencode`;

    // Check if opencode binary exists
    if (!existsSync(opencodeBinary)) {
      console.log('[opencode-web] opencode binary not found at', opencodeBinary);
      console.log('[opencode-web] Make sure opencode service runs first (it creates the wrapper)');
      return {
        pid: null,
        process: null,
        cleanup: async () => {}
      };
    }

    // Initialize OpenCode user directory if it doesn't exist
    if (!existsSync(opencodeUserDir)) {
      console.log('[opencode-web] Initializing OpenCode user directory at', opencodeUserDir);
      try {
        // Run opencode --version to initialize the config directory
        execSync(`${opencodeBinary} --version`, {
          env: { 
            ...env, 
            PATH: `/usr/local/local/nvm/versions/node/v23.11.1/bin:${env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`,
            HOME: homeDir 
          },
          stdio: 'pipe',
          timeout: 30000
        });
        console.log('[opencode-web] ✓ OpenCode user directory initialized');
      } catch (e) {
        console.log('[opencode-web] Warning: OpenCode initialization returned:', e.message);
      }
    }

    const password = env.PASSWORD || 'default';
    const fqdn = env.COOLIFY_FQDN || 'localhost:9997';
    
    console.log(`[opencode-web] Starting OpenCode web on port 9997`);
    console.log(`[opencode-web] Using OPENCODE_SERVER_PASSWORD: ${password.substring(0, 3)}***`);
    console.log(`[opencode-web] External FQDN: ${fqdn}`);
    console.log(`[opencode-web] User config directory: ${opencodeUserDir}`);

    // Kill any existing process on port 9997 to prevent "Address already in use" errors
    try {
      const { exec } = await import('child_process');
      const util = await import('util');
      const execPromise = util.promisify(exec);
      await execPromise('lsof -ti:9997 | xargs -r kill -9 2>/dev/null || true');
      console.log('[opencode-web] Cleared any existing process on port 9997');
      await sleep(500); // Give time for port to be released
    } catch (e) {
      console.log('[opencode-web] Warning: Could not clear port 9997:', e.message);
    }

    // Start opencode web service with password from PASSWORD env var
    // OpenCode expects HTTP Basic Auth with the password set via OPENCODE_SERVER_PASSWORD
    // Pass FQDN for proper CORS/CSP configuration
    // Run as user 'abc' to ensure config goes to user's home directory
    // Environment variables with PATH are automatically included by supervisor
    const ps = spawn('sudo', ['-u', 'abc', '-E', opencodeBinary, 'web', '--port', '9997', '--hostname', '127.0.0.1', '--print-logs'], {
      env: { 
        ...env,
        HOME: homeDir,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_EXTERNAL_URL: `https://${fqdn}/code/`,
        OPENCODE_FQDN: fqdn
      },
      stdio: ['pipe', 'pipe', 'pipe'],
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
