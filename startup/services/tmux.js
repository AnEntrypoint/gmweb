import { spawn, execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';

const WEBTOP_USER = process.env.SUDO_USER || 'abc';
const HOME_DIR = '/config';
const TMUX_CONF = `${HOME_DIR}/.tmux.conf`;

export default {
  name: 'tmux',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[tmux] Starting tmux session...');

    try {
      execSync('which tmux', { stdio: 'pipe' });
    } catch (e) {
      console.log('[tmux] tmux binary not found, skipping');
      return { pid: 0, process: null, cleanup: async () => {} };
    }

    try {
      writeFileSync(TMUX_CONF, [
        'set-option -g default-shell /bin/bash',
        'set-option -g default-command "bash -i -l"',
        'set-option -g update-environment "DISPLAY WINDOWID XAUTHORITY"',
        'set-option -g mouse on',
        'set-option -g history-limit 50000',
        'bind-key -T copy-mode-vi Enter send-keys -X copy-pipe-and-cancel "xclip -i -selection clipboard 2>/dev/null || true"',
        'bind-key -T copy-mode-vi y send-keys -X copy-pipe-and-cancel "xclip -i -selection clipboard 2>/dev/null || true"',
        ''
      ].join('\n'));
    } catch (e) {
      console.log(`[tmux] Config write failed: ${e.message}`);
    }

    const ps = spawn('bash', ['-c', [
      `tmux kill-session -t main 2>/dev/null || true`,
      `sleep 1`,
      `tmux -f ${TMUX_CONF} new-session -d -s main -x 120 -y 30 -c ${HOME_DIR} "bash -i -l"`,
      `sleep 1`,
      `tmux new-window -t main -n sshd`,
      `echo "[tmux] Session created"`,
    ].join('\n')], {
      env: { ...env, HOME: HOME_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    ps.unref();
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => {
        try { process.kill(-ps.pid, 'SIGKILL'); } catch (e) {}
      }
    };
  },

  async health() {
    try {
      execSync('which tmux', { stdio: 'pipe' });
      execSync('tmux list-sessions 2>&1 | grep -q main', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
