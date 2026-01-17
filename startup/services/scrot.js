// Scrot service - screenshot utility (installed at build time via install.sh)
import { spawn } from 'child_process';

export default {
  name: 'scrot',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // scrot is installed at build time, no runtime action needed
    // Just return a dummy handle
    return {
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    };
  },

  async health() {
    // Check if scrot binary exists
    try {
      const { execSync } = await import('child_process');
      execSync('which scrot', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
