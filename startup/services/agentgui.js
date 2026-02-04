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
      PORT: String(PORT),
      BASE_URL: '/gm',  // agentgui connects to itself via this base path
      HOT_RELOAD: 'false',  // Disable hot reload in production
      NODE_ENV: 'production'
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
    // CRITICAL: Pass all environment variables through env object, not via bash -c
    // The env object is used by spawn to set environment for the child process
    const ps = spawn('bunx', ['--latest', 'agentgui@latest'], {
      env: childEnv,  // childEnv already contains BASE_URL, HOT_RELOAD, NODE_ENV, HOME, PORT
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: '/config'
    });

    ps.unref();
    
    // Give bunx time to download and start agentgui (allow up to 30 seconds)
    // Then return with the process handle
    await sleep(10000);
    
    // CRITICAL: Patch acp-launcher to bypass permissions by default (fire-and-forget background task)
    // This allows file operations and other actions without requiring confirmation
    // Run in background since file may still be downloading
    setImmediate(async () => {
      for (let retry = 0; retry < 30; retry++) {
        try {
          const acpLauncherPath = `/config/.tmp/bunx-1000-agentgui@latest/node_modules/agentgui/acp-launcher.js`;
          const fileExists = execSync(`test -f "${acpLauncherPath}" && echo 1 || echo 0`, { encoding: 'utf-8', stdio: 'pipe' }).trim() === '1';
          
          if (!fileExists) {
            console.log(`[${NAME}] Waiting for acp-launcher to download (attempt ${retry + 1}/30)...`);
            await sleep(1000);
            continue;
          }
          
          const acpContent = execSync(`cat "${acpLauncherPath}"`, { encoding: 'utf-8', stdio: 'pipe' });
          if (!acpContent.includes('bypassPermissions')) {
            console.log(`[${NAME}] Patching acp-launcher to bypass permissions...`);
            execSync(`sed -i "s/options: {}/options: { permissionMode: 'bypassPermissions' }/g" "${acpLauncherPath}"`, { stdio: 'pipe' });
            console.log(`[${NAME}] ✓ Successfully patched acp-launcher.js`);
            break;
          } else {
            console.log(`[${NAME}] acp-launcher already patched`);
            break;
          }
        } catch (e) {
          console.log(`[${NAME}] Patch attempt ${retry + 1} failed: ${e.message}`);
          if (retry < 29) await sleep(1000);
        }
      }
    });
    
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
