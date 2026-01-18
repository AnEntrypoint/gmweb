// KasmProxy Authentication Wrapper service
// Runs on port 80, forwards to:
// - Webtop web UI on port 3000
// - Selkies WebSocket on port 8082
// HTTP Basic Auth for all routes except /data/* and /ws/*
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'kasmproxy-wrapper',
  type: 'critical',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const processEnv = {
      ...env,
      PASSWORD: env.PASSWORD || 'password',
      CUSTOM_PORT: env.CUSTOM_PORT || '6901',
      SUBFOLDER: env.SUBFOLDER || '/desk/',
      PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const ps = spawn('node', ['/opt/gmweb-startup/kasmproxy-wrapper.js'], {
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[kasmproxy-wrapper] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[kasmproxy-wrapper:err] ${data.toString().trim()}`);
    });

    ps.unref();

    return {
      pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-pid, 'SIGTERM');
          await sleep(2000);
          process.kill(-pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :80 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
