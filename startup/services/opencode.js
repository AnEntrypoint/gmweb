// OpenCode AI installation service
// Creates a wrapper script that uses npx to run opencode-ai
import { execSync } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';

const NPX_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/npx';
const WRAPPER_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/opencode';

export default {
  name: 'opencode',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Check if already installed and working
    if (await this.health()) {
      console.log('[opencode] Already installed and working');
      return { pid: 0, process: null, cleanup: async () => {} };
    }

    console.log('[opencode] Creating npx wrapper script...');

    try {
      // Create wrapper script that uses npx
      const wrapperContent = `#!/bin/bash
# OpenCode AI wrapper - uses npx to avoid global install issues
exec ${NPX_PATH} -y opencode-ai "$@"
`;
      writeFileSync(WRAPPER_PATH, wrapperContent);
      chmodSync(WRAPPER_PATH, '755');
      console.log('[opencode] ✓ Wrapper script created at ' + WRAPPER_PATH);

      // Pre-cache the package by running --help
      console.log('[opencode] Pre-caching package via npx...');
      try {
        execSync(`${NPX_PATH} -y opencode-ai --help`, {
          stdio: 'pipe',
          timeout: 120000,
          env: { ...env }
        });
        console.log('[opencode] ✓ Package cached successfully');
      } catch (e) {
        console.log('[opencode] Warning: Pre-cache failed, will cache on first use');
      }

    } catch (err) {
      console.log('[opencode] Failed to create wrapper:', err.message);
    }

    return { pid: 0, process: null, cleanup: async () => {} };
  },

  async health() {
    // Check if wrapper exists and works
    try {
      if (!existsSync(WRAPPER_PATH)) {
        return false;
      }
      // Verify it actually runs
      execSync(`${WRAPPER_PATH} --help`, { stdio: 'pipe', timeout: 30000 });
      return true;
    } catch (e) {
      return false;
    }
  }
};
