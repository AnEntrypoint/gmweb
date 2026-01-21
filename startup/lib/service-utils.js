// Shared utilities for services to reduce boilerplate and duplication
import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

/**
 * Create an npx wrapper script for a CLI tool
 * Eliminates duplicated wrapper creation across multiple services
 * 
 * @param {string} binPath - Where to create the wrapper (e.g., /usr/local/bin/tool)
 * @param {string} packageName - npm package name (e.g., opencode-ai)
 * @returns {boolean} - true if wrapper created successfully
 */
export function createNpxWrapper(binPath, packageName) {
  try {
    const wrapperContent = `#!/bin/bash
# ${packageName} wrapper - uses npx to avoid global install issues
exec /usr/local/local/nvm/versions/node/v23.11.1/bin/npx -y ${packageName} "$@"
`;
    writeFileSync(binPath, wrapperContent);
    chmodSync(binPath, '755');
    return true;
  } catch (e) {
    console.error(`Failed to create wrapper at ${binPath}:`, e.message);
    return false;
  }
}

/**
 * Precache an npm package via npx
 * Runs with timeout to prevent hanging
 * 
 * @param {string} packageName - npm package to cache
 * @param {object} env - environment variables
 * @param {number} timeout - max time in ms (default 120000)
 * @returns {boolean} - true if successful or skipped
 */
export function precacheNpmPackage(packageName, env, timeout = 120000) {
  try {
    const NPX_PATH = '/usr/local/local/nvm/versions/node/v23.11.1/bin/npx';
    execSync(`${NPX_PATH} -y ${packageName} --help`, {
      stdio: 'pipe',
      timeout,
      env
    });
    return true;
  } catch (e) {
    // Cache failure is not critical - will cache on first use
    return false;
  }
}

/**
 * Clone or update a git repository
 * Handles permissions and git configuration for abc user
 * 
 * @param {string} repoUrl - git repository URL
 * @param {string} targetDir - where to clone/update
 * @param {object} env - environment variables
 * @returns {Promise<{cloned: boolean, updated: boolean, error?: string}>}
 */
export async function gitCloneOrUpdate(repoUrl, targetDir, env) {
  const { execSync: execSyncFunc } = await import('child_process');
  
  try {
    if (existsSync(targetDir)) {
      // Update existing repo
      try {
        execSyncFunc(`sudo chown -R abc:abc "${targetDir}" 2>/dev/null || true`);
        execSyncFunc(`sudo -u abc git config --global --add safe.directory "${targetDir}" 2>/dev/null || true`);
        execSyncFunc(`cd "${targetDir}" && timeout 30 sudo -u abc git pull origin main 2>/dev/null || true`);
        return { updated: true, cloned: false };
      } catch (e) {
        return { updated: false, cloned: false, error: e.message };
      }
    } else {
      // Clone new repo
      try {
        execSyncFunc(`sudo -u abc git clone ${repoUrl} ${targetDir} 2>&1`, { stdio: 'pipe' });
        execSyncFunc(`sudo chown -R abc:abc "${targetDir}"`);
        return { cloned: true, updated: false };
      } catch (e) {
        return { cloned: false, updated: false, error: e.message };
      }
    }
  } catch (e) {
    return { cloned: false, updated: false, error: e.message };
  }
}

/**
 * Run a shell command as abc user with proper environment
 * 
 * @param {string} command - shell command to run
 * @param {object} env - environment variables
 * @param {object} options - spawn options
 * @returns {Promise<{pid: number, process: ChildProcess}>}
 */
export async function spawnAsAbcUser(command, env = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn('sudo', ['-u', 'abc', '-E', 'bash', '-c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      ...options,
      env: { ...env }
    });

    ps.on('error', reject);
    
    // Resolve immediately - process runs in background
    resolve({
      pid: ps.pid,
      process: ps
    });
  });
}

/**
 * Wait for a port to be listening (for health checks)
 * 
 * @param {number} port - port to check
 * @param {number} timeout - max wait time in ms (default 5000)
 * @returns {Promise<boolean>} - true if port is listening
 */
export async function waitForPort(port, timeout = 5000) {
  const net = await import('net');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      return await new Promise((resolve) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          resolve(false);
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          resolve(false);
        });
      });
    } catch (e) {
      await sleep(500);
    }
  }

  return false;
}

/**
 * Base service template - extend this for common patterns
 * Reduces boilerplate in individual service files
 */
export const BaseService = {
  type: 'system',
  requiresDesktop: false,
  dependencies: [],
  
  // Services should implement these:
  // name: 'service-name',
  // async start(env) { /* startup logic */ },
  // async health() { /* health check */ }
};

/**
 * Create an install service (package installer/wrapper creator)
 */
export function createInstallService(name, {
  installerFn, // async function that runs during start(env)
  healthCheckFn // function that checks if service is installed
}) {
  return {
    name,
    type: 'install',
    requiresDesktop: false,
    dependencies: [],
    
    async start(env) {
      try {
        await installerFn(env);
        return { pid: 0, process: null, cleanup: async () => {} };
      } catch (err) {
        console.error(`[${name}] Installation failed:`, err.message);
        return { pid: 0, process: null, cleanup: async () => {} };
      }
    },
    
    async health() {
      try {
        return await healthCheckFn();
      } catch (e) {
        return false;
      }
    }
  };
}
