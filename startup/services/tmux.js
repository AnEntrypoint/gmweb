// Tmux session management service
// Ensures tmux starts with login shell so .bashrc/.profile are sourced for correct PATH
import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const WEBTOP_USER = process.env.SUDO_USER || 'abc';

export default {
  name: 'tmux',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Always use /config as home directory for tmux session
    // env.HOME might not be set correctly when supervisor runs
    const homeDir = '/config';
    const tmuxConfPath = `${homeDir}/.tmux.conf`;
    
    console.log('[tmux] Setting up tmux configuration and session...');
    
    // Create tmux config to ensure login shell and correct environment
    const tmuxConfig = `# Auto-generated tmux config for gmweb
set-option -g default-shell /bin/bash
set-option -g default-command "bash -i -l"
set-option -g update-environment "DISPLAY WINDOWID XAUTHORITY"
set-option -g mouse on
set-option -g history-limit 50000
`;
    
    const ps = spawn('bash', ['-c', `
      # Write tmux config
      cat > ${tmuxConfPath} << 'EOF'
${tmuxConfig}
EOF
      chown ${WEBTOP_USER}:${WEBTOP_USER} ${tmuxConfPath}
      
      # Kill any existing main session
      sudo -u ${WEBTOP_USER} tmux kill-session -t main 2>/dev/null || true
      sleep 1
      
      # Create new session with login shell
      sudo -u ${WEBTOP_USER} tmux new-session -d -s main -x 120 -y 30 -c ${homeDir} "bash -i -l"
      sleep 1
      sudo -u ${WEBTOP_USER} tmux new-window -t main -n sshd
      
      echo "[tmux] Session created successfully"
    `], {
      env: { ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.unref();
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try {
          process.kill(-ps.pid, 'SIGKILL');
        } catch (e) {}
      }
    };
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync(`sudo -u ${WEBTOP_USER} tmux list-sessions | grep -q main`, { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
