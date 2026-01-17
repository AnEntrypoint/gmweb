// ProxyPilot service - network daemon
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'proxypilot',
  type: 'critical',
  requiresDesktop: true,
  dependencies: [],

  async start(env) {
    const ps = spawn('/usr/bin/proxypilot', [], {
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
