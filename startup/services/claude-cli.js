// Claude CLI installation service
import { spawn } from 'child_process';

const WEBTOP_USER = process.env.SUDO_USER || 'abc';
const HOME_DIR = process.env.HOME || '/config';

export default {
  name: 'claude-cli',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('sudo', ['-u', WEBTOP_USER, 'bash', '-c', `export TMPDIR=${HOME_DIR}/.tmp && export HOME=${HOME_DIR} && curl -fsSL https://claude.ai/install.sh | bash`], {
      env: { ...env, HOME: HOME_DIR },
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
      execSync(`test -f ${HOME_DIR}/.local/bin/claude`, { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
