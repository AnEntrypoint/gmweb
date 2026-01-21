// Gemini CLI installation service
// Creates npx wrapper for @google/gemini-cli
import { existsSync } from 'fs';
import { createNpxWrapper, precacheNpmPackage } from '../lib/service-utils.js';

const WRAPPER_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/gemini';
const PACKAGE_NAME = '@google/gemini-cli';

export default {
  name: 'gemini-cli',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[gemini-cli] Creating npx wrapper...');
    if (!createNpxWrapper(WRAPPER_PATH, PACKAGE_NAME)) {
      return { pid: 0, process: null, cleanup: async () => {} };
    }
    
    console.log('[gemini-cli] ✓ Wrapper created');
    console.log('[gemini-cli] Pre-caching package...');
    precacheNpmPackage(PACKAGE_NAME, env);
    
    return { pid: 0, process: null, cleanup: async () => {} };
  },

  async health() {
    // Just check if wrapper exists (health checks should be lightweight)
    return existsSync(WRAPPER_PATH);
  }
};
