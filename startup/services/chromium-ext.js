// Chromium Extension enablement service
// Note: Extension enablement script not yet implemented
import { spawn } from 'child_process';

export default {
  name: 'chromium-ext',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Extension enablement script not yet implemented
    // Return immediately as healthy
    console.log('[chromium-ext] Extension enablement not yet implemented');
    return {
      pid: process.pid,
      process: null,
      cleanup: async () => {}
    };
  },

  async health() {
    // Always healthy since this is a stub
    return true;
  }
};
