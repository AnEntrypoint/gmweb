import { spawn } from 'child_process';

const NAME = 'gmgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service...`);
    const ps = spawn('npx', ['-y', 'gxe@latest', 'AnEntrypoint/gmgui'], {
      cwd: '/config',
      env: { ...env, HOME: '/config' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.stdout?.on('data', d => {
      console.log(`[${NAME}] ${d.toString().trim()}`);
    });
    ps.stderr?.on('data', d => {
      console.log(`[${NAME}:err] ${d.toString().trim()}`);
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
    return true;
  }
};
