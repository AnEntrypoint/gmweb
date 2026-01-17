// Gemini CLI installation service
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export default {
  name: 'gemini-cli',
  type: 'install',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Use full path to npm since sudo doesn't inherit NVM PATH
    const npmPath = '/usr/local/local/nvm/versions/node/v23.11.1/bin/npm';
    const ps = spawn('bash', ['-c', `
      ${npmPath} install -g @google/gemini-cli
    `], {
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const pid = ps.pid;

    ps.stdout?.on('data', (data) => {
      console.log(`[gemini-cli:install] ${data.toString().trim()}`);
    });
    ps.stderr?.on('data', (data) => {
      console.log(`[gemini-cli:install:err] ${data.toString().trim()}`);
    });

    ps.unref();

    return {
      pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-pid, 'SIGTERM');
          await sleep(1000);
          process.kill(-pid, 'SIGKILL');
        } catch (e) {
          // Process already dead
        }
      }
    };
  },

  async health() {
    // Installation services are healthy once they complete
    try {
      const { execSync } = await import('child_process');
      execSync('which gemini-cli', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
