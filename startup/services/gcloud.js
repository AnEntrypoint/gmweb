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
    // Install gcloud SDK non-interactively
    const ps = spawn('bash', ['-c', `
      curl -sSL https://sdk.cloud.google.com > /tmp/install_gcloud.sh
      bash /tmp/install_gcloud.sh --disable-prompts --install-dir=/home/kasm-user
      rm -f /tmp/install_gcloud.sh
    `], {
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
      // Check both PATH and direct install location
      execSync('which gcloud || test -f /home/kasm-user/google-cloud-sdk/bin/gcloud', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
