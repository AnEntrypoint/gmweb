import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'kasmproxy',
  type: 'critical',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const password = env.PASSWORD || 'password';
    const subfolder = (env.SUBFOLDER || '/').replace(/\/+$/, '') || '/';
    const listenPort = 80;

    console.log('[kasmproxy] Starting via gxe: npx -y gxe@latest AnEntrypoint/kasmproxy');
    console.log('[kasmproxy] LISTEN_PORT:', listenPort);
    console.log('[kasmproxy] PASSWORD:', password ? password.substring(0, 3) + '***' : '(not set)');
    console.log('[kasmproxy] SUBFOLDER:', subfolder);

    // Spawn kasmproxy via gxe/npx
    // gxe fetches and runs the latest version from GitHub
    const kasmproxyProcess = spawn('npx', [
      '-y',
      'gxe@latest',
      'AnEntrypoint/kasmproxy'
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
      env: {
        ...process.env,
        PASSWORD: password,
        SUBFOLDER: subfolder,
        LISTEN_PORT: String(listenPort),
        WEBTOP_UI_PORT: '6901',
        SELKIES_WS_PORT: '8082',
        NODE_OPTIONS: '--no-warnings'
      }
    });

    let processExited = false;
    let exitCode = 0;

    kasmproxyProcess.on('exit', (code) => {
      processExited = true;
      exitCode = code;
      console.log(`[kasmproxy] Process exited with code ${code}`);
    });

    kasmproxyProcess.on('error', (err) => {
      processExited = true;
      console.error('[kasmproxy] Spawn error:', err.message);
    });

    // Wait for kasmproxy to start listening (give it 30 seconds)
    const startTimeout = 30000;
    const startTime = Date.now();
    
    while (!processExited && Date.now() - startTime < startTimeout) {
      await sleep(100);
    }

    if (processExited && exitCode !== 0) {
      throw new Error(`kasmproxy failed to start (exit code: ${exitCode})`);
    }

    console.log('[kasmproxy] Process started successfully');

    return {
      pid: kasmproxyProcess.pid,
      process: kasmproxyProcess,
      cleanup: async () => {
        if (!kasmproxyProcess.killed) {
          kasmproxyProcess.kill('SIGTERM');
          await sleep(2000);
          if (!kasmproxyProcess.killed) {
            kasmproxyProcess.kill('SIGKILL');
          }
        }
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
