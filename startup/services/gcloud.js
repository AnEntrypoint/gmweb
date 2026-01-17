// Google Cloud SDK installation service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'gcloud',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('sudo', ['-u', 'kasm-user', 'bash', '-c', 'curl https://sdk.cloud.google.com | bash'], {
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
      execSync('which gcloud', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
