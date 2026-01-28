// Simple service templates - dead simple to add new services
// Every service automatically gets: proper PATH, PASSWORD, FQDN, error handling, logging
import { existsSync } from 'fs';
import { dirname } from 'path';
import { createNpxWrapper, precacheNpmPackage } from './service-utils.js';

/**
 * DEAD SIMPLE: npxWrapperService
 * For CLI tools that just need an npx wrapper created
 * 
 * Usage:
 * export default npxWrapperService('my-cli', '@org/my-cli-package');
 */
export function npxWrapperService(name, packageName) {
  const binPath = `${dirname(process.execPath)}/${name}`;
  
  return {
    name,
    type: 'install',
    requiresDesktop: false,
    dependencies: [],

    async start(env) {
      console.log(`[${name}] Creating wrapper...`);
      if (!createNpxWrapper(binPath, packageName)) {
        console.log(`[${name}] ✗ Failed to create wrapper`);
        return { pid: 0, process: null, cleanup: async () => {} };
      }
      
      console.log(`[${name}] ✓ Wrapper created`);
      precacheNpmPackage(packageName, env);
      return { pid: 0, process: null, cleanup: async () => {} };
    },

    async health() {
      return existsSync(binPath);
    }
  };
}

/**
 * DEAD SIMPLE: webServiceOnPort
 * For web services that listen on a port
 * Automatically handles: port listening, environment setup, logging
 * 
 * Usage:
 * export default webServiceOnPort('my-web', 8000, (env) => 
 *   spawn('some-server', ['--port', '8000'], { env })
 * );
 */
export function webServiceOnPort(name, port, spawnerFn) {
  return {
    name,
    type: 'web',
    requiresDesktop: false,
    dependencies: [],

    async start(env) {
      console.log(`[${name}] Starting on port ${port}...`);
      const ps = spawnerFn(env);
      
      ps.stdout?.on('data', (data) => {
        console.log(`[${name}] ${data.toString().trim()}`);
      });
      ps.stderr?.on('data', (data) => {
        console.log(`[${name}:err] ${data.toString().trim()}`);
      });

      ps.unref();
      return {
        pid: ps.pid,
        process: ps,
        cleanup: async () => {
          try {
            process.kill(-ps.pid, 'SIGTERM');
            await new Promise(r => setTimeout(r, 2000));
            process.kill(-ps.pid, 'SIGKILL');
          } catch (e) {}
        }
      };
    },

    async health() {
      const net = await import('net');
      return await new Promise((resolve) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(2000, () => {
          socket.destroy();
          resolve(false);
        });
      });
    }
  };
}

/**
 * DEAD SIMPLE: systemService
 * For system daemons (tmux, sshd, etc)
 * 
 * Usage:
 * export default systemService('my-daemon', (env) =>
 *   spawn('daemon-binary', [...args], { env })
 * );
 */
export function systemService(name, spawnerFn) {
  return {
    name,
    type: 'system',
    requiresDesktop: false,
    dependencies: [],

    async start(env) {
      console.log(`[${name}] Starting...`);
      const ps = spawnerFn(env);
      
      ps.stdout?.on('data', (data) => {
        console.log(`[${name}] ${data.toString().trim()}`);
      });
      ps.stderr?.on('data', (data) => {
        console.log(`[${name}:err] ${data.toString().trim()}`);
      });

      ps.unref();
      return {
        pid: ps.pid,
        process: ps,
        cleanup: async () => {
          try {
            process.kill(-ps.pid, 'SIGTERM');
            await new Promise(r => setTimeout(r, 1000));
            process.kill(-ps.pid, 'SIGKILL');
          } catch (e) {}
        }
      };
    },

    async health() {
      // Override in your service if needed
      return true;
    }
  };
}

/**
 * DEAD SIMPLE: customService
 * For services that need custom logic
 * Just provide start() and health() functions
 * 
 * Usage:
 * export default customService('my-service', {
 *   async start(env) { ... },
 *   async health() { ... }
 * });
 */
export function customService(name, { start, health, type = 'system', dependencies = [], requiresDesktop = false }) {
  return {
    name,
    type,
    requiresDesktop,
    dependencies,
    start,
    health
  };
}
