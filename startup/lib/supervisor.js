// Immortal Supervisor: Never crashes, always recovers
// Follows gm:state:machine mandatory rules

import { spawnSync, spawn, execSync } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import path from 'path';
const { join } = path;

const sleep = promisify(setTimeout);

export class Supervisor {
  constructor(config = {}) {
    console.log('[supervisor] Initializing supervisor...');
    this.config = {
      healthCheckInterval: 30000,
      maxRestartAttempts: 5,
      baseBackoffDelay: 5000,
      maxBackoffDelay: 60000,
      logDirectory: process.env.HOME ? `${process.env.HOME}/logs` : '/config/logs',
      ...config
    };

    console.log('[supervisor] Log directory:', this.config.logDirectory);

    this.services = new Map();
    this.running = true;
    this.restartAttempts = new Map();
    this.processes = new Map();

    // Setup log directories
    this.setupLogDirectories();
    console.log('[supervisor] Constructor complete');

    // Global error handlers - never let anything crash
    process.on('uncaughtException', (err) => {
      this.log('ERROR', 'Uncaught exception', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.log('ERROR', 'Unhandled rejection', reason);
    });
  }

  register(service) {
    if (!this.validate(service)) {
      this.log('ERROR', `Invalid service: ${service.name}`);
      return false;
    }
    this.services.set(service.name, service);
    this.restartAttempts.set(service.name, 0);
    return true;
  }

  validate(service) {
    return service &&
      typeof service.name === 'string' &&
      typeof service.start === 'function' &&
      typeof service.health === 'function';
  }

  async start() {
    this.log('INFO', 'Supervisor starting - immortal mode enabled');

    try {
      // Wait for desktop if any service requires it
      if (this.needsDesktop()) {
        await this.waitForDesktop();
      }

       // Setup environment once
       this.env = await this.getEnvironment();

       // Resolve dependencies and sort services
        const sorted = this.topologicalSort();
        if (!sorted) {
          this.log('ERROR', 'Circular dependency detected');
          return;
        }

        // Group services into dependency chains for parallel startup
        // Services with no dependencies can start in parallel
        // Services with dependencies must wait for their deps to complete
        const groups = this.groupServicesByDependency(sorted);
        
        // Start service groups in sequence, but start independent services in parallel
        for (const group of groups) {
          const startPromises = group.map(async (service) => {
            // Check if service is explicitly disabled (default is enabled)
            const serviceConfig = this.config.services?.[service.name];
            const isEnabled = serviceConfig?.enabled !== false;

            if (!isEnabled) {
              this.log('INFO', `Skipping disabled service: ${service.name}`);
              return;
            }

            try {
              await this.startService(service);
            } catch (err) {
              this.log('ERROR', `Failed to start ${service.name}`, err);
              if (service.type === 'critical') {
                this.log('WARN', `Critical service failed, attempting recovery`);
                await sleep(2000);
                await this.startService(service);
              }
            }
          });
          
          // Wait for all services in this group to complete before starting next group
          await Promise.all(startPromises);
        }

      // Monitor health continuously (runs forever)
      // This runs forever and never returns - keep it running in background
      this.monitorHealth().catch(err => {
        this.log('ERROR', 'Health monitoring crashed', err);
        // Restart health monitoring on crash
        this.start();
      });

      // Supervisor now runs indefinitely - keeps services alive
      this.log('INFO', 'Supervisor ready - monitoring services');

      // Keep start() alive forever (doesn't return)
      await new Promise(() => {});  // Never resolves - blocks forever
    } catch (err) {
      this.log('ERROR', 'Supervisor crash prevented', err);
      await sleep(5000);
      await this.start();
    }
  }



  async startService(service) {
    this.log('INFO', `Starting service`, null, service.name);

    try {
      const result = await service.start(this.env);

      // Attach output handlers to capture service logs
      if (result.process) {
        result.process.stdout?.on('data', (data) => {
          this.logServiceOutput(service.name, 'stdout', data);
        });
        result.process.stderr?.on('data', (data) => {
          this.logServiceOutput(service.name, 'stderr', data);
        });
      }

      this.processes.set(service.name, {
        pid: result.pid,
        process: result.process,
        cleanup: result.cleanup,
        startedAt: Date.now(),
        attempts: 0
      });

      this.restartAttempts.set(service.name, 0);
      this.log('INFO', `Service started (PID: ${result.pid})`, null, service.name);
    } catch (err) {
      this.log('ERROR', `Service startup failed`, err, service.name);
      throw err;
    }
  }

  async monitorHealth() {
    while (this.running) {
      try {
        for (const [name, service] of this.services) {
          // Check if service is explicitly disabled (default is enabled)
          const serviceConfig = this.config.services?.[name];
          const isEnabled = serviceConfig?.enabled !== false;
          if (!isEnabled) continue;

          try {
            const healthy = await service.health();
            if (!healthy) {
              this.log('WARN', `Health check failed`, null, name);
              await this.restartService(service);
            }
          } catch (err) {
            this.log('ERROR', `Health check error`, err, name);
            await this.restartService(service);
          }
        }

        await sleep(this.config.healthCheckInterval);
      } catch (err) {
        this.log('ERROR', 'Health monitoring error (recovering)', err);
        await sleep(5000);
      }
    }
  }

  async restartService(service) {
    const attempts = this.restartAttempts.get(service.name) || 0;

    if (attempts >= this.config.maxRestartAttempts) {
      this.log('WARN', `Max restart attempts reached (${attempts})`, null, service.name);
      return;
    }

    const delay = Math.min(
      this.config.baseBackoffDelay * Math.pow(2, attempts),
      this.config.maxBackoffDelay
    );

    this.log('INFO', `Restarting (attempt ${attempts + 1}, delay ${delay}ms)`, null, service.name);

    try {
      // Stop existing process
      const handle = this.processes.get(service.name);
      if (handle?.cleanup) {
        try {
          await handle.cleanup();
        } catch (err) {
          this.log('WARN', `Cleanup failed`, err, service.name);
        }
      }

      await sleep(delay);

      // Start service again
      await this.startService(service);
      this.restartAttempts.set(service.name, 0);
    } catch (err) {
      this.log('ERROR', `Restart failed`, err, service.name);
      this.restartAttempts.set(service.name, attempts + 1);
    }
  }

  topologicalSort() {
     const visited = new Set();
     const sorted = [];
     const visiting = new Set();

     const visit = (name) => {
       if (visited.has(name)) return true;
       if (visiting.has(name)) return false; // Circular

       visiting.add(name);

       const service = this.services.get(name);
       if (service?.dependencies) {
         for (const dep of service.dependencies) {
           if (!visit(dep)) return false;
         }
       }

       visiting.delete(name);
       visited.add(name);
       sorted.push(service);
       return true;
     };

     for (const [name] of this.services) {
       if (!visit(name)) return null;
     }

     return sorted;
   }

   groupServicesByDependency(sorted) {
     // Group services into layers where each layer can run in parallel
     // Layer N contains services that only depend on services in layers 0..N-1
     // This respects the topological sort order while maximizing parallelism
     const groups = [];
     const serviceToGroup = new Map(); // Maps service name to its group index
     
     // Process services in topologically sorted order
     for (const service of sorted) {
       let groupIndex = 0;
       
       // Find the minimum group index we can use
       // It must be after all our dependencies
       if (service.dependencies && service.dependencies.length > 0) {
         for (const dep of service.dependencies) {
           const depGroup = serviceToGroup.get(dep);
           if (depGroup !== undefined) {
             groupIndex = Math.max(groupIndex, depGroup + 1);
           }
         }
       }
       
       // Add this service to the appropriate group
       serviceToGroup.set(service.name, groupIndex);
       
       if (!groups[groupIndex]) {
         groups[groupIndex] = [];
       }
       groups[groupIndex].push(service);
     }
     
     this.log('INFO', `Organized ${sorted.length} services into ${groups.length} parallel startup groups`);
     groups.forEach((group, idx) => {
       const names = group.map(s => s.name).join(', ');
       this.log('INFO', `  Group ${idx + 1} (parallel): ${names}`);
     });
     
     return groups;
   }

  needsDesktop() {
    for (const [name, service] of this.services) {
      if (this.config.services?.[name]?.enabled !== false && service.requiresDesktop) {
        return true;
      }
    }
    return false;
  }

  async waitForDesktop() {
    this.log('INFO', 'Waiting for Webtop desktop to be ready...');

    for (let i = 0; i < 60; i++) {
      try {
        if (existsSync('/tmp/.X11-unix/X1')) {
          this.log('INFO', 'Desktop ready');
          return;
        }
      } catch (err) {
        // Continue waiting
      }

      await sleep(1000);
    }

    this.log('WARN', 'Desktop ready timeout after 60 seconds, continuing anyway');
  }

  async getEnvironment() {
    const env = { ...process.env };

    // DEBUG: Log all relevant container environment variables
    this.log('DEBUG', '=== CONTAINER ENVIRONMENT ===');
    this.log('DEBUG', `process.env.PASSWORD: ${env.PASSWORD ? env.PASSWORD.substring(0, 3) + '***' : '(not set)'}`);
    this.log('DEBUG', `process.env.CUSTOM_PORT: ${env.CUSTOM_PORT}`);
    this.log('DEBUG', `process.env.SUBFOLDER: ${env.SUBFOLDER}`);
    this.log('DEBUG', '=== END ENVIRONMENT ===');

    // Setup Node.js PATH - ALWAYS include NVM and local bin first
    const NVM_BIN = path.dirname(process.execPath);
    const LOCAL_BIN = `${process.env.HOME}/.local/bin`;
    env.PATH = `${NVM_BIN}:${LOCAL_BIN}:${env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`;

    if (!env.PASSWORD) {
      env.PASSWORD = 'password';
      this.log('WARN', '⚠ No PASSWORD set, using default');
    } else {
      this.log('INFO', `✓ PASSWORD configured: ${env.PASSWORD.substring(0, 3)}***`);
    }

    // Setup D-Bus session for XFCE and other desktop services
    // xfconfd requires a valid D-Bus session bus to initialize
    if (!env.DBUS_SESSION_BUS_ADDRESS) {
      // Use the standard user session bus socket in /run/user/$UID
      const uid = process.getuid ? process.getuid() : 1000;
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
      this.log('INFO', `✓ D-Bus session configured: ${env.DBUS_SESSION_BUS_ADDRESS}`);
    }

    // Setup D-Bus system bus (needed for some services)
    if (!env.DBUS_SYSTEM_BUS_ADDRESS) {
      env.DBUS_SYSTEM_BUS_ADDRESS = 'unix:path=/run/dbus/system_bus_socket';
      this.log('INFO', `✓ D-Bus system bus configured: ${env.DBUS_SYSTEM_BUS_ADDRESS}`);
    }

    // Setup X11 environment (required for XFCE desktop)
    if (!env.DISPLAY) {
      env.DISPLAY = ':1.0';
      this.log('INFO', `✓ DISPLAY configured: ${env.DISPLAY}`);
    }

    // Setup X11 authority file for authentication
    if (!env.XAUTHORITY) {
      const home = env.HOME || '/config';
      env.XAUTHORITY = `${home}/.Xauthority`;
      this.log('INFO', `✓ XAUTHORITY configured: ${env.XAUTHORITY}`);
    }

    // Setup XDG runtime directory (required for D-Bus socket and other runtime files)
    if (!env.XDG_RUNTIME_DIR) {
      const uid = process.getuid ? process.getuid() : 1000;
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
      this.log('INFO', `✓ XDG_RUNTIME_DIR configured: ${env.XDG_RUNTIME_DIR}`);
    }

    return env;
  }

  // Core: Spawn with supervisor's pre-configured environment
  // ALL services use this so they all get: PATH, PASSWORD, FQDN, HOME, etc.
  spawnWithEnv(command, args, options = {}) {
    // Merge supervisor's environment with any service-specific overrides
    const finalEnv = {
      ...this.env,
      ...options.env
    };

    // Always ensure PATH has NVM first (failsafe)
    const NVM_BIN = path.dirname(process.execPath);
    const LOCAL_BIN = `${this.env.HOME || '/config'}/.local/bin`;
    if (!finalEnv.PATH?.startsWith(NVM_BIN)) {
      finalEnv.PATH = `${NVM_BIN}:${LOCAL_BIN}:${finalEnv.PATH}`;
    }

    const finalOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      ...options,
      env: finalEnv
    };

    return spawn(command, args, finalOptions);
  }

  setupLogDirectories() {
    try {
      const baseDir = this.config.logDirectory;
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(join(baseDir, 'services'), { recursive: true });

      // Fix ownership if running as root
      if (process.getuid() === 0) {
        try {
          execSync(`chown -R abc:abc "${baseDir}"`, { stdio: 'ignore' });
        } catch (e) {
          // Ignore ownership errors
        }
      }

      // Create log index file for easy reference
      const indexPath = join(baseDir, 'LOG_INDEX.txt');
      const indexContent = `GMWEB Log Directory
====================
Generated: ${new Date().toISOString()}

Log Files:
- supervisor.log     : Main supervisor orchestration log
- startup.log        : Boot-time custom_startup.sh log
- services/          : Per-service logs (one file per service)

Per-Service Logs:
  services/<service-name>.log   : stdout/stderr and events for each service
  services/<service-name>.err   : stderr only (errors and warnings)

Tips:
- Use 'tail -f supervisor.log' to watch supervisor activity
- Use 'tail -f services/*.log' to watch all service output
- Use 'grep ERROR *.log' to find errors across all logs
`;
      writeFileSync(indexPath, indexContent);
    } catch (e) {
      // Ignore - will try again on first log
    }
  }

  log(level, msg, err = null, serviceName = null) {
    const timestamp = new Date().toISOString();
    const message = err ? `${msg}: ${err.message}` : msg;
    const prefix = serviceName ? `[${serviceName}]` : '[supervisor]';
    const formattedMsg = `[${timestamp}] [${level.padEnd(5)}] ${prefix} ${message}`;

    console.log(formattedMsg);

    // Persist to main supervisor log
    try {
      const logPath = join(this.config.logDirectory, 'supervisor.log');
      appendFileSync(logPath, formattedMsg + '\n');
    } catch (e) {
      // Silence log file errors
    }

    // Also log to service-specific file if serviceName provided
    if (serviceName) {
      try {
        const serviceLogPath = join(this.config.logDirectory, 'services', `${serviceName}.log`);
        appendFileSync(serviceLogPath, formattedMsg + '\n');

        // Log errors to separate .err file for easy filtering
        if (level === 'ERROR' || level === 'WARN') {
          const serviceErrPath = join(this.config.logDirectory, 'services', `${serviceName}.err`);
          appendFileSync(serviceErrPath, formattedMsg + '\n');
        }
      } catch (e) {
        // Silence
      }
    }
  }

  // Log service output (stdout/stderr) to dedicated service log
  logServiceOutput(serviceName, stream, data) {
    const timestamp = new Date().toISOString();
    const lines = data.toString().trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const prefix = stream === 'stderr' ? 'ERR' : 'OUT';
      const formattedMsg = `[${timestamp}] [${prefix}] ${line}`;

      try {
        const serviceLogPath = join(this.config.logDirectory, 'services', `${serviceName}.log`);
        appendFileSync(serviceLogPath, formattedMsg + '\n');

        // Also log stderr to .err file
        if (stream === 'stderr') {
          const serviceErrPath = join(this.config.logDirectory, 'services', `${serviceName}.err`);
          appendFileSync(serviceErrPath, formattedMsg + '\n');
        }
      } catch (e) {
        // Silence
      }

      // Also print to console with service prefix
      console.log(`[${serviceName}:${prefix.toLowerCase()}] ${line}`);
    }
  }

  stop() {
    this.log('INFO', 'Supervisor stopping (graceful shutdown)');
    this.running = false;

    for (const [name, handle] of this.processes) {
      try {
        if (handle.cleanup) handle.cleanup();
      } catch (err) {
        this.log('WARN', `Cleanup failed for ${name}`, err);
      }
    }
  }
}
