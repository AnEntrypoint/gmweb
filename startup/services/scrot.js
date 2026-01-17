// Scrot installation service
import { spawn } from 'child_process';

export default {
  name: 'scrot',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('bash', ['-c', 'apt-get update && apt-get install -y scrot'], {
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.unref();
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('which scrot', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
