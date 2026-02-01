import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';

const NAME = 'gmgui';
const PORT = 9897;

export default {
  name: NAME,
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log(`[${NAME}] Starting service...`);
    
    try {
      // Use gxe to download/extract gmgui repo
      const baseDir = '/config/.gxe';
      const repoPath = `${baseDir}/gmgui-repo`;
      
      // Create directory if it doesn't exist
      if (!existsSync(repoPath)) {
        execSync(`mkdir -p ${repoPath}`, { stdio: 'pipe' });
      }
      
      // Clone the gmgui repo using gxe (it will extract to current dir)
      // First check if already cloned
      const packageJsonPath = `${repoPath}/package.json`;
      if (!existsSync(packageJsonPath)) {
        console.log(`[${NAME}] Extracting gmgui repository...`);
        execSync('npx -y gxe@latest AnEntrypoint/gmgui', {
          cwd: repoPath,
          env: { ...env, HOME: '/config' },
          stdio: 'pipe'
        });
      }
      
      // Install dependencies
      console.log(`[${NAME}] Installing dependencies...`);
      execSync('npm install', {
        cwd: repoPath,
        env: { ...env, HOME: '/config' },
        stdio: 'pipe'
      });
      
      // Start the server
      const ps = spawn('node', ['server.js'], {
        cwd: repoPath,
        env: { ...env, HOME: '/config', PORT: String(PORT) },
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
    } catch (e) {
      console.error(`[${NAME}:err] Failed to start: ${e.message}`);
      throw e;
    }
  },

  async health() {
    try {
      execSync(`ss -tlnp 2>/dev/null | grep :${PORT}`, { shell: true, stdio: 'pipe' });
      return true;
    } catch (err) {
      return false;
    }
  }
};
