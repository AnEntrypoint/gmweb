// Chromium Extension enablement service
import { spawn } from 'child_process';

export default {
  name: 'chromium-ext',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const ps = spawn('sudo', ['-u', 'kasm-user', 'python3', '/usr/local/bin/enable_chromium_extension.py'], {
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
    // Health check for extension
    return true;
  }
};
