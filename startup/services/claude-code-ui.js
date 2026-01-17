// Claude Code UI service - web interface for Claude Code
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'claude-code-ui',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const appPath = '/opt/claudecodeui';

    // Check if Claude Code UI is installed
    if (!existsSync(appPath)) {
      console.log('[claude-code-ui] Not installed at ' + appPath + ' - service unavailable');
      return {
        pid: null,
        process: null,
        cleanup: async () => {}
      };
    }

    // Start Claude Code UI on port 9997
    const ps = spawn('npm', ['run', 'dev', '--', '-p', '9997'], {
      cwd: appPath,
      env: { ...env, PORT: '9997' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[claude-code-ui] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[claude-code-ui:err] ${data.toString().trim()}`);
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
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    // Check if port 9997 is listening
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :9997 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
