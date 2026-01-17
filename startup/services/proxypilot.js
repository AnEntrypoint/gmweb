// ProxyPilot service - network daemon
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'proxypilot',
  type: 'critical',
  requiresDesktop: true,
  dependencies: [],

  async start(env) {
    const binaryPath = '/usr/bin/proxypilot';

    // Check if binary exists before attempting to spawn
    if (!existsSync(binaryPath)) {
      console.log('[proxypilot] Binary not found at ' + binaryPath + ' - service unavailable');
      return {
        pid: null,
        process: null,
        cleanup: async () => {}
      };
    }

    const ps = spawn(binaryPath, [], {
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[proxypilot] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[proxypilot:err] ${data.toString().trim()}`);
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
      const { execSync } = await import('child_process');
      execSync('ps aux | grep -q "[p]roxypilot"', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
