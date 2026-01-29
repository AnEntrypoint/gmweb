import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import path from 'path';
import { SupervisorLogger } from './supervisor-logger.js';
import { topologicalSort, groupByDependency } from './dependency-sort.js';
const sleep = promisify(setTimeout);

export class Supervisor {
  constructor(config = {}) {
    this.config = {
      healthCheckInterval: 30000,
      maxRestartAttempts: 5,
      baseBackoffDelay: 5000,
      maxBackoffDelay: 60000,
      logDirectory: process.env.HOME ? `${process.env.HOME}/logs` : '/config/logs',
      ...config
    };
    this.services = new Map();
    this.running = true;
    this.restartAttempts = new Map();
    this.processes = new Map();
    this.logger = new SupervisorLogger(this.config.logDirectory);
    process.on('uncaughtException', (err) => this.logger.log('ERROR', 'Uncaught exception', err));
    process.on('unhandledRejection', (reason) => this.logger.log('ERROR', 'Unhandled rejection', reason));
  }

  register(service) {
    if (!service?.name || typeof service.start !== 'function' || typeof service.health !== 'function') {
      this.logger.log('ERROR', `Invalid service: ${service?.name}`);
      return false;
    }
    this.services.set(service.name, service);
    this.restartAttempts.set(service.name, 0);
    return true;
  }

  async start() {
    this.logger.log('INFO', 'Supervisor starting');
    try {
      if (this.needsDesktop()) await this.waitForDesktop();
      this.env = await this.getEnvironment();
      await this.ensureNginxAuth();
      const sorted = topologicalSort(this.services);
      if (!sorted) { this.logger.log('ERROR', 'Circular dependency'); return; }
      const groups = groupByDependency(sorted, this.logger);

      for (const group of groups) {
        await Promise.all(group.map(async (service) => {
          if (this.config.services?.[service.name]?.enabled === false) {
            this.logger.log('INFO', `Skipping disabled: ${service.name}`);
            return;
          }
          try {
            await this.startService(service);
          } catch (err) {
            this.logger.log('ERROR', `Failed to start ${service.name}`, err);
            if (service.type === 'critical') {
              await sleep(2000);
              await this.startService(service);
            }
          }
        }));
      }

      this.monitorHealth().catch(err => {
        this.logger.log('ERROR', 'Health monitoring crashed', err);
        this.start();
      });

      this.logger.log('INFO', 'Supervisor ready');
      await new Promise(() => {});
    } catch (err) {
      this.logger.log('ERROR', 'Supervisor crash prevented', err);
      await sleep(5000);
      await this.start();
    }
  }

  async startService(service) {
    this.logger.log('INFO', `Starting service`, null, service.name);
    const result = await service.start(this.env);
    if (result.process) {
      result.process.stdout?.on('data', d => this.logger.logServiceOutput(service.name, 'stdout', d));
      result.process.stderr?.on('data', d => this.logger.logServiceOutput(service.name, 'stderr', d));
    }
    this.processes.set(service.name, {
      pid: result.pid, process: result.process, cleanup: result.cleanup,
      startedAt: Date.now(), attempts: 0
    });
    this.restartAttempts.set(service.name, 0);
    this.logger.log('INFO', `Service started (PID: ${result.pid})`, null, service.name);
  }

  async monitorHealth() {
    while (this.running) {
      try {
        for (const [name, service] of this.services) {
          if (this.config.services?.[name]?.enabled === false) continue;
          try {
            if (!(await service.health())) {
              this.logger.log('WARN', `Health check failed`, null, name);
              await this.restartService(service);
            }
          } catch (err) {
            this.logger.log('ERROR', `Health check error`, err, name);
            await this.restartService(service);
          }
        }
        await sleep(this.config.healthCheckInterval);
      } catch (err) {
        this.logger.log('ERROR', 'Health monitoring error', err);
        await sleep(5000);
      }
    }
  }

  async restartService(service) {
    const attempts = this.restartAttempts.get(service.name) || 0;
    if (attempts >= this.config.maxRestartAttempts) {
      this.logger.log('WARN', `Max restart attempts (${attempts})`, null, service.name);
      return;
    }
    const delay = Math.min(this.config.baseBackoffDelay * Math.pow(2, attempts), this.config.maxBackoffDelay);
    this.logger.log('INFO', `Restarting (attempt ${attempts + 1}, delay ${delay}ms)`, null, service.name);
    try {
      const handle = this.processes.get(service.name);
      if (handle?.cleanup) { try { await handle.cleanup(); } catch (e) {} }
      await sleep(delay);
      await this.startService(service);
      this.restartAttempts.set(service.name, 0);
    } catch (err) {
      this.logger.log('ERROR', `Restart failed`, err, service.name);
      this.restartAttempts.set(service.name, attempts + 1);
    }
  }

  needsDesktop() {
    for (const [name, service] of this.services) {
      if (this.config.services?.[name]?.enabled !== false && service.requiresDesktop) return true;
    }
    return false;
  }

  async waitForDesktop() {
    this.logger.log('INFO', 'Waiting for desktop...');
    for (let i = 0; i < 60; i++) {
      if (existsSync('/tmp/.X11-unix/X1')) { this.logger.log('INFO', 'Desktop ready'); return; }
      await sleep(1000);
    }
    this.logger.log('WARN', 'Desktop timeout after 60s, continuing');
  }

  async ensureNginxAuth() {
    const pw = this.env.PASSWORD || 'password';
    try {
      const hash = execSync('openssl passwd -apr1 -stdin', { input: pw, encoding: 'utf8' }).trim();
      const escaped = hash.replace(/\$/g, '\\$');
      execSync(`sudo sh -c 'printf "abc:%s\\n" "${escaped}" > /etc/nginx/.htpasswd'`, { timeout: 10000, stdio: 'pipe' });
      execSync('sudo nginx -s reload', { timeout: 10000, stdio: 'pipe' });
      this.logger.log('INFO', 'nginx auth configured');
    } catch (err) { this.logger.log('WARN', `nginx auth: ${err.message}`); }
  }

  async getEnvironment() {
    const env = { ...process.env };
    const NVM_BIN = path.dirname(process.execPath);
    const NVM_LIB = path.join(NVM_BIN, '..', 'lib', 'node_modules');
    const LOCAL_BIN = `${process.env.HOME}/.local/bin`;
    env.PATH = `${NVM_BIN}:${LOCAL_BIN}:${env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`;
    env.NODE_PATH = `${NVM_LIB}:${env.NODE_PATH || ''}`;
    if (!env.PASSWORD) { env.PASSWORD = 'password'; }

    const uid = process.getuid?.() || 1000;

    if (!env.DBUS_SESSION_BUS_ADDRESS) {
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
      this.logger.log('INFO', `D-Bus session configured: ${env.DBUS_SESSION_BUS_ADDRESS}`);
    }
    if (!env.DBUS_SYSTEM_BUS_ADDRESS) {
      env.DBUS_SYSTEM_BUS_ADDRESS = 'unix:path=/run/dbus/system_bus_socket';
      this.logger.log('INFO', `D-Bus system bus configured: ${env.DBUS_SYSTEM_BUS_ADDRESS}`);
    }
    if (!env.DISPLAY) {
      env.DISPLAY = ':1.0';
      this.logger.log('INFO', `DISPLAY configured: ${env.DISPLAY}`);
    }
    if (!env.XAUTHORITY) {
      env.XAUTHORITY = `${env.HOME || '/config'}/.Xauthority`;
      this.logger.log('INFO', `XAUTHORITY configured: ${env.XAUTHORITY}`);
    }
    if (!env.XDG_RUNTIME_DIR) {
      env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
      this.logger.log('INFO', `XDG_RUNTIME_DIR configured: ${env.XDG_RUNTIME_DIR}`);
    }

    return env;
  }

  spawnWithEnv(command, args, options = {}) {
    const finalEnv = { ...this.env, ...options.env };
    const NVM_BIN = path.dirname(process.execPath);
    if (!finalEnv.PATH?.startsWith(NVM_BIN)) {
      finalEnv.PATH = `${NVM_BIN}:${this.env.HOME || '/config'}/.local/bin:${finalEnv.PATH}`;
    }
    return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true, ...options, env: finalEnv });
  }

  stop() {
    this.logger.log('INFO', 'Supervisor stopping');
    this.running = false;
    for (const [name, handle] of this.processes) {
      try { if (handle.cleanup) handle.cleanup(); } catch (err) {
        this.logger.log('WARN', `Cleanup failed for ${name}`, err);
      }
    }
  }
}
