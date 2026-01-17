// Immortal Supervisor: Never crashes, always recovers
// Follows gm:state:machine mandatory rules
// UPDATED: Prioritizes kasmproxy startup - starts first, blocks others until healthy

import { spawnSync, spawn, execSync } from 'child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';

const sleep = promisify(setTimeout);

export class Supervisor {
  constructor(config = {}) {
    this.config = {
      healthCheckInterval: 30000,
      maxRestartAttempts: 5,
      baseBackoffDelay: 5000,
      maxBackoffDelay: 60000,
      logDirectory: '/home/kasm-user/logs',
      kasmproxyStartupTimeout: 120000, // 2 minutes max to wait for kasmproxy
      ...config
    };

    this.services = new Map();
    this.running = true;
    this.restartAttempts = new Map();
    this.processes = new Map();
    this.kasmproxyHealthy = false;

    // Setup log directories
    this.setupLogDirectories();

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

      // CRITICAL: Start kasmproxy FIRST and wait for it to be healthy
      const kasmproxy = this.services.get('kasmproxy');
      if (kasmproxy) {
        this.log('INFO', '=== CRITICAL: Starting kasmproxy first ===');
        try {
          await this.startService(kasmproxy);

          // Wait for kasmproxy to be healthy (blocks other services)
          await this.waitForKasmproxyHealthy();
          this.kasmproxyHealthy = true;
          this.log('INFO', 'kasmproxy is healthy - proceeding with other services');
        } catch (err) {
          this.log('ERROR', 'Failed to start kasmproxy', err);
          this.log('WARN', 'Attempting recovery...');
          await sleep(2000);
          await this.startService(kasmproxy);
        }
      }

      // Resolve dependencies and sort remaining services
      const sorted = this.topologicalSort();
      if (!sorted) {
        this.log('ERROR', 'Circular dependency detected');
        return;
      }

      // Start all other services (kasmproxy already started)
      for (const service of sorted) {
        // Skip kasmproxy - already started
        if (service.name === 'kasmproxy') continue;

        // Check if service is explicitly disabled (default is enabled)
        const serviceConfig = this.config.services?.[service.name];
        const isEnabled = serviceConfig?.enabled !== false;

        if (!isEnabled) {
          this.log('INFO', `Skipping disabled service: ${service.name}`);
          continue;
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
      }

      // Monitor health continuously
      await this.monitorHealth();
    } catch (err) {
      this.log('ERROR', 'Supervisor crash prevented', err);
      await sleep(5000);
      await this.start();
    }
  }

  async waitForKasmproxyHealthy() {
    const startTime = Date.now();
    const timeout = this.config.kasmproxyStartupTimeout;

    this.log('INFO', 'Waiting for kasmproxy to be healthy...');

    while (Date.now() - startTime < timeout) {
      try {
        const kasmproxy = this.services.get('kasmproxy');
        if (kasmproxy && await kasmproxy.health()) {
          this.log('INFO', 'kasmproxy is healthy!');
          return;
        }
      } catch (err) {
        // Continue waiting
      }

      await sleep(2000);
    }

    this.log('WARN', 'kasmproxy health check timeout after ' + Math.round((Date.now() - startTime) / 1000) + 's - continuing anyway');
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

  needsDesktop() {
    for (const [name, service] of this.services) {
      if (this.config.services[name]?.enabled && service.requiresDesktop) {
        return true;
      }
    }
    return false;
  }

  async waitForDesktop() {
    this.log('INFO', 'Waiting for Kasm desktop to be ready...');
    const desktopReadyBin = '/usr/bin/desktop_ready';

    for (let i = 0; i < 120; i++) {
      try {
        if (existsSync(desktopReadyBin)) {
          const result = spawnSync('bash', ['-c', desktopReadyBin], { timeout: 5000 });
          if (result.status === 0) {
            this.log('INFO', 'Desktop ready');
            return;
          }
        }
      } catch (err) {
        // Continue waiting
      }

      await sleep(1000);
    }

    this.log('WARN', 'Desktop ready timeout after 2 minutes, continuing anyway');
  }

  async getEnvironment() {
    const env = { ...process.env };

    // Setup Node.js PATH
    env.PATH = `/usr/local/local/nvm/versions/node/v23.11.1/bin:${env.PATH}`;
    env.PATH = `${process.env.HOME}/.local/bin:${env.PATH}`;

    // Extract or set VNC_PW
    if (!env.VNC_PW) {
      try {
        const vncPw = execSync("strings /proc/1/environ | grep '^VNC_PW=' | cut -d= -f2-", { encoding: 'utf8' }).trim();
        if (vncPw) env.VNC_PW = vncPw;
      } catch (err) {
        this.log('WARN', 'Could not extract VNC_PW, using default');
        env.VNC_PW = 'password';
      }
    }

    return env;
  }

  setupLogDirectories() {
    try {
      const baseDir = this.config.logDirectory;
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(join(baseDir, 'services'), { recursive: true });

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
