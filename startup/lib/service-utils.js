import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export function createNpxWrapper(binPath, packageName) {
  try {
    const wrapperContent = `#!/bin/bash\nexec ${dirname(process.execPath)}/npx -y ${packageName} "$@"\n`;
    writeFileSync(binPath, wrapperContent);
    chmodSync(binPath, '755');
    return true;
  } catch (e) {
    console.error(`Failed to create wrapper at ${binPath}:`, e.message);
    return false;
  }
}

/**
 * Ensures a directory exists with proper permissions for the abc user.
 * This is a critical utility to prevent permission issues across all services.
 * 
 * @param {string} dir - The directory path to ensure exists
 * @param {string} serviceName - Name of the service (for logging)
 * @returns {boolean} - Whether the directory is ready for use
 */
export function ensureDirectory(dir, serviceName = 'service') {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`[${serviceName}] Created directory: ${dir}`);
    }
    
    // Fix ownership to abc:abc
    try {
      execSync(`chown abc:abc "${dir}" 2>/dev/null || true`);
      execSync(`chmod 755 "${dir}" 2>/dev/null || true`);
    } catch (e) {
      // Non-fatal: directory exists but ownership fix failed
      console.log(`[${serviceName}] Warning: Could not fix ownership for ${dir}: ${e.message}`);
    }
    
    return true;
  } catch (e) {
    console.error(`[${serviceName}] Failed to ensure directory ${dir}: ${e.message}`);
    return false;
  }
}

/**
 * Ensures critical service directories exist with proper permissions.
 * This function sets up the standard directory structure that services expect.
 * 
 * @param {string} homeDir - The home directory (usually /config)
 * @param {string} serviceName - Name of the service (for logging)
 * @param {Array<string>} extraDirs - Additional directories specific to this service
 */
export function ensureServiceEnvironment(homeDir, serviceName = 'service', extraDirs = []) {
  const dirs = [
    homeDir,
    `${homeDir}/.local`,
    `${homeDir}/.local/bin`,
    `${homeDir}/.local/share`,
    `${homeDir}/.config`,
    `${homeDir}/.gmweb`,
    `${homeDir}/.gmweb/cache`,
    `${homeDir}/.tmp`,
    `${homeDir}/logs`,
    `${homeDir}/workspace`,
    ...extraDirs
  ];
  
  console.log(`[${serviceName}] Ensuring service environment...`);
  
  for (const dir of dirs) {
    ensureDirectory(dir, serviceName);
  }
  
  // Fix ownership on critical parent directories
  try {
    execSync(`chown -R abc:abc "${homeDir}/.local" 2>/dev/null || true`);
    execSync(`chown -R abc:abc "${homeDir}/.config" 2>/dev/null || true`);
    execSync(`chown -R abc:abc "${homeDir}/.gmweb" 2>/dev/null || true`);
    execSync(`chown abc:abc "${homeDir}" 2>/dev/null || true`);
    console.log(`[${serviceName}] Fixed ownership on critical directories`);
  } catch (e) {
    console.log(`[${serviceName}] Warning: Could not fix ownership: ${e.message}`);
  }
  
  console.log(`[${serviceName}] Service environment ready`);
}

export function precacheNpmPackage(packageName, env, timeout = 120000) {
  const NPX_PATH = `${dirname(process.execPath)}/npx`;
  const child = spawn(NPX_PATH, ['-y', packageName, '--help'], {
    stdio: 'pipe',
    env,
    detached: true
  });
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) {} }, timeout);
  child.on('exit', () => clearTimeout(timer));
  child.unref();
  return true;
}

export async function gitCloneOrUpdate(repoUrl, targetDir, env) {
  const { execSync: execSyncFunc } = await import('child_process');
  try {
    if (existsSync(targetDir)) {
      try {
        execSyncFunc(`sudo chown -R abc:abc "${targetDir}" 2>/dev/null || true`);
        execSyncFunc(`sudo -u abc git config --global --add safe.directory "${targetDir}" 2>/dev/null || true`);
        execSyncFunc(`cd "${targetDir}" && timeout 30 sudo -u abc git pull origin main 2>/dev/null || true`);
        return { updated: true, cloned: false };
      } catch (e) {
        return { updated: false, cloned: false, error: e.message };
      }
    } else {
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

export function spawnAsAbcUser(command, env) {
  // Use bash -l (login shell) to ensure .profile and .bashrc are sourced,
  // which sets up PATH with NVM bin directory and other tools
  return spawn('sudo', ['-u', 'abc', '-E', 'bash', '-l', '-c', command], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, ...env }
  });
}

export async function waitForPort(port, timeout = 5000) {
  const net = await import('net');
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      return await new Promise((resolve) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => resolve(false));
        socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
      });
    } catch (e) {
      await sleep(500);
    }
  }
  return false;
}

export const BaseService = {
  type: 'system',
  requiresDesktop: false,
  dependencies: []
};

export function createInstallService(name, { installerFn, healthCheckFn }) {
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
      try { return await healthCheckFn(); } catch (e) { return false; }
    }
  };
}
