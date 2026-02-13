// OpenCode CLI Service
// Installs the opencode-ai CLI and platform-specific binary
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { arch, platform } from 'os';
import { createNpxWrapper, precacheNpmPackage } from '../lib/service-utils.js';

const NAME = 'opencode';
const PKG = 'opencode-ai';

function resolveOpencodeBinary() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const p = platformMap[platform()] || platform();
  const a = archMap[arch()] || arch();
  const platformPkg = `opencode-${p}-${a}`;
  const npmGlobalLib = '/config/.gmweb/npm-global/lib/node_modules';
  const binCandidate = join(npmGlobalLib, platformPkg, 'bin', 'opencode');
  if (existsSync(binCandidate)) {
    return binCandidate;
  }
  return null;
}

function installPlatformBinary() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const p = platformMap[platform()] || platform();
  const a = archMap[arch()] || arch();
  const platformPkg = `opencode-${p}-${a}`;
  try {
    console.log(`[${NAME}] Installing ${PKG} and ${platformPkg} globally...`);
    execSync(`npm install -g ${PKG} ${platformPkg} 2>&1`, {
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, HOME: '/config' }
    });
    console.log(`[${NAME}] Installed ${PKG} + ${platformPkg}`);
    return true;
  } catch (e) {
    console.log(`[${NAME}] npm install failed: ${e.message}`);
    return false;
  }
}

export default {
  name: NAME,
  type: 'install',
  requiresDesktop: false,
  dependencies: ['opencode-config'],

  async start(env) {
    const homeDir = env.HOME || '/config';
    const binPath = `${dirname(process.execPath)}/${NAME}`;

    // Ensure directories exist
    const opencodeConfigDir = `${homeDir}/.config/opencode`;
    const opencodeStorageDir = `${homeDir}/.local/share/opencode/storage`;
    try {
      if (!existsSync(opencodeConfigDir)) {
        mkdirSync(opencodeConfigDir, { recursive: true });
      }
      if (!existsSync(opencodeStorageDir)) {
        mkdirSync(opencodeStorageDir, { recursive: true });
      }
      execSync(`sudo chown -R abc:abc "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chown -R abc:abc "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeConfigDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`sudo chmod -R 750 "${opencodeStorageDir}" 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      console.log(`[${NAME}] Warning: Could not setup opencode directories: ${e.message}`);
    }

    // Try to install platform-specific binary for better performance
    let opencodeBinPath = resolveOpencodeBinary();
    if (!opencodeBinPath) {
      installPlatformBinary();
      opencodeBinPath = resolveOpencodeBinary();
    }

    if (opencodeBinPath) {
      console.log(`[${NAME}] Using platform binary: ${opencodeBinPath}`);
      // Create a direct symlink to the platform binary for faster startup
      try {
        execSync(`ln -sf "${opencodeBinPath}" "${binPath}" 2>/dev/null || true`, { stdio: 'pipe' });
        console.log(`[${NAME}] Created symlink to platform binary`);
      } catch (e) {
        // Fallback to npx wrapper
        console.log(`[${NAME}] Falling back to npx wrapper`);
      }
    }

    // If no platform binary, create npx wrapper
    if (!existsSync(binPath)) {
      console.log(`[${NAME}] Creating npx wrapper...`);
      if (!createNpxWrapper(binPath, PKG)) {
        console.log(`[${NAME}] Failed to create wrapper`);
        return { pid: 0, process: null, cleanup: async () => {} };
      }
      console.log(`[${NAME}] Wrapper created`);
    }

    // Precache the package for faster first use
    precacheNpmPackage(PKG, env);

    console.log(`[${NAME}] OpenCode CLI installed successfully`);

    return {
      pid: 0,
      process: null,
      cleanup: async () => {}
    };
  },

  async health() {
    try {
      const binPath = `${dirname(process.execPath)}/${NAME}`;
      return existsSync(binPath);
    } catch (e) {
      return false;
    }
  }
};
