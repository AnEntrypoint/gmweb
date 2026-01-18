// SSH Daemon service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const WEBTOP_USER = process.env.SUDO_USER || 'abc';

export default {
  name: 'sshd',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Create combined environment with VNC_PW
    const processEnv = {
      ...env,
      VNC_PW: env.VNC_PW || env.PASSWORD || 'password'
    };

    const ps = spawn('bash', ['-c', `
      sudo mkdir -p /run/sshd
      if [ -n "$VNC_PW" ]; then
        echo "${WEBTOP_USER}:$VNC_PW" | sudo chpasswd
      fi
      sudo /usr/sbin/sshd
    `], {
      env: processEnv,
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
      execSync('lsof -i :22 | grep -q sshd', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
