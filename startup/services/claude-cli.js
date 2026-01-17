// Claude CLI installation service
import { spawn } from 'child_process';

export default {
  name: 'claude-cli',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('sudo', ['-u', 'kasm-user', 'bash', '-c', 'export TMPDIR=/home/kasm-user/.tmp && curl -fsSL https://claude.ai/install.sh | bash'], {
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
      execSync('test -f /home/kasm-user/.local/bin/claude', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
