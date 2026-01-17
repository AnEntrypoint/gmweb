// Gemini CLI installation service
// Creates a wrapper script that uses npx to run gemini-cli
// This avoids global npm install corruption issues
import { execSync } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';

const NPX_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/npx';
const WRAPPER_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/gemini';

export default {
  name: 'gemini-cli',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Check if already installed and working
    if (await this.health()) {
      console.log('[gemini-cli] Already installed and working');
      return { pid: 0, process: null, cleanup: async () => {} };
    }

    console.log('[gemini-cli] Creating npx wrapper script...');

    try {
      // Create wrapper script that uses npx
      const wrapperContent = `#!/bin/bash
# Gemini CLI wrapper - uses npx to avoid global install issues
exec ${NPX_PATH} -y @google/gemini-cli "$@"
`;
      writeFileSync(WRAPPER_PATH, wrapperContent);
      chmodSync(WRAPPER_PATH, '755');
      console.log('[gemini-cli] ✓ Wrapper script created at ' + WRAPPER_PATH);

      // Pre-cache the package by running --help
      console.log('[gemini-cli] Pre-caching package via npx...');
      try {
        execSync(`${NPX_PATH} -y @google/gemini-cli --help`, {
          stdio: 'pipe',
          timeout: 120000,
          env: { ...env }
        });
        console.log('[gemini-cli] ✓ Package cached successfully');
      } catch (e) {
        console.log('[gemini-cli] Warning: Pre-cache failed, will cache on first use');
      }

    } catch (err) {
      console.log('[gemini-cli] Failed to create wrapper:', err.message);
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
