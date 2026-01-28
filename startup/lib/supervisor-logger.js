import { appendFileSync, mkdirSync, statSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

export class SupervisorLogger {
  constructor(logDirectory) {
    this.logDirectory = logDirectory;
    this.setup();
  }

  setup() {
    try {
      mkdirSync(this.logDirectory, { recursive: true });
      mkdirSync(join(this.logDirectory, 'services'), { recursive: true });
      if (process.getuid?.() === 0) {
        try { execSync(`chown -R abc:abc "${this.logDirectory}"`, { stdio: 'ignore' }); } catch (e) {}
      }
    } catch (e) {}
  }

  log(level, msg, err = null, serviceName = null) {
    const ts = new Date().toISOString();
    const message = err ? `${msg}: ${err.message}` : msg;
    const prefix = serviceName ? `[${serviceName}]` : '[supervisor]';
    const line = `[${ts}] [${level.padEnd(5)}] ${prefix} ${message}\n`;

    try {
      const logPath = join(this.logDirectory, 'supervisor.log');
      appendFileSync(logPath, line, 'utf8');
      try {
        if (statSync(logPath).size > 100 * 1024 * 1024) {
          renameSync(logPath, `${logPath}.${Date.now()}`);
        }
      } catch (e) {}
    } catch (e) {}

    if (serviceName) {
      try {
        appendFileSync(join(this.logDirectory, 'services', `${serviceName}.log`), line, 'utf8');
        if (level === 'ERROR' || level === 'WARN') {
          appendFileSync(join(this.logDirectory, 'services', `${serviceName}.err`), line, 'utf8');
        }
      } catch (e) {}
    }
  }

  logServiceOutput(serviceName, stream, data) {
    const ts = new Date().toISOString();
    for (const raw of data.toString().trim().split('\n')) {
      if (!raw.trim()) continue;
      const prefix = stream === 'stderr' ? 'ERR' : 'OUT';
      const line = `[${ts}] [${prefix}] ${raw}\n`;
      try {
        appendFileSync(join(this.logDirectory, 'services', `${serviceName}.log`), line, 'utf8');
        if (stream === 'stderr') {
          appendFileSync(join(this.logDirectory, 'services', `${serviceName}.err`), line, 'utf8');
        }
      } catch (e) {}
    }
  }
}
