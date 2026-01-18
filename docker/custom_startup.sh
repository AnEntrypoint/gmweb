#!/bin/bash
# LinuxServer Webtop Custom Startup Script
# Purpose: Setup gmweb services on top of webtop base
# Runs via /custom-cont-init.d/ mechanism

set -e

# Webtop uses /config as home directory
HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[gmweb-startup] $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== GMWEB STARTUP $(date) ====="

# ============================================================================
# Fix npm permissions
# ============================================================================
if [ -d "$HOME_DIR/.npm" ]; then
  log "Fixing npm cache permissions..."
  chown -R abc:abc "$HOME_DIR/.npm" 2>/dev/null || true
  log "✓ npm permissions fixed"
fi

if [ ! -d "$HOME_DIR/.npm" ]; then
  mkdir -p "$HOME_DIR/.npm"
  chown -R abc:abc "$HOME_DIR/.npm"
  log "✓ npm cache directory created"
fi

# ============================================================================
# Copy ProxyPilot config (from build-time download)
# ============================================================================
if [ -f /opt/proxypilot-config.yaml ] && [ ! -f "$HOME_DIR/config.yaml" ]; then
  log "Copying ProxyPilot config..."
  cp /opt/proxypilot-config.yaml "$HOME_DIR/config.yaml"
  chown abc:abc "$HOME_DIR/config.yaml"
  log "✓ ProxyPilot config copied"
fi

# ============================================================================
# Fix NVM directory permissions
# ============================================================================
if [ -d /usr/local/local/nvm ]; then
  log "Fixing NVM directory permissions..."
  chown -R abc:abc /usr/local/local/nvm 2>/dev/null || true
  log "✓ NVM permissions fixed"
fi

# ============================================================================
# Fix Claude Code UI permissions
# ============================================================================
if [ -d /opt/claudecodeui ]; then
  log "Fixing Claude Code UI permissions..."
  chown -R abc:abc /opt/claudecodeui 2>/dev/null || true
  log "✓ Claude Code UI permissions fixed"

  # Setup Claude Code UI user (background)
  log "Setting up Claude Code UI user (background)..."
  nohup bash -c "cd /opt/claudecodeui && node -e \"
    const Database = require('better-sqlite3');
    const bcrypt = require('bcrypt');
    const vncPw = process.env.PASSWORD || process.env.VNC_PW || '';
    if (!vncPw) { console.log('No PASSWORD/VNC_PW, skipping'); process.exit(0); }
    const db = new Database('/opt/claudecodeui/server/database/auth.db');
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('abc');
    if (user) {
      const hash = bcrypt.hashSync(vncPw, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'abc');
      console.log('Updated abc user password');
    } else {
      const hash = bcrypt.hashSync(vncPw, 10);
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('abc', hash);
      console.log('Created abc user');
    }
    db.close();
  \"" > "$LOG_DIR/claudeui-user.log" 2>&1 &
  log "✓ Claude Code UI user setup started (background)"
fi

# ============================================================================
# Setup .bashrc PATH (first boot only)
# ============================================================================
BASHRC_MARKER="$HOME_DIR/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  log "Setting up .bashrc PATH configuration..."

  cat >> "$HOME_DIR/.bashrc" << 'BASHRC_EOF'

# gmweb PATH setup
export NVM_DIR="/usr/local/local/nvm"
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$HOME/.local/bin:$PATH"

# Claude Code function with --dangerously-skip-permissions
ccode() { claude --dangerously-skip-permissions "$@"; }
BASHRC_EOF

  touch "$BASHRC_MARKER"
  chown abc:abc "$BASHRC_MARKER"
  log "✓ .bashrc PATH configured"
else
  log "✓ .bashrc already configured (skipping)"
fi

# ============================================================================
# Setup Claude MCP and plugins (first boot only)
# ============================================================================
CLAUDE_MARKER="$HOME_DIR/.gmweb-claude-setup"
if [ ! -f "$CLAUDE_MARKER" ]; then
  log "Setting up Claude MCP and plugins (background)..."

  nohup bash -c "
    export HOME=$HOME_DIR
    # Add playwriter MCP server
    $HOME_DIR/.local/bin/claude mcp add playwriter npx -- -y playwriter@latest || true

    # Add gm plugin from marketplace
    $HOME_DIR/.local/bin/claude plugin marketplace add AnEntrypoint/gm || true
    $HOME_DIR/.local/bin/claude plugin install -s user gm@gm || true

    touch $HOME_DIR/.gmweb-claude-setup
    chown abc:abc $HOME_DIR/.gmweb-claude-setup
  " > "$LOG_DIR/claude-setup.log" 2>&1 &
  log "✓ Claude MCP and plugins setup started (background)"
else
  log "✓ Claude already configured (skipping)"
fi

# ============================================================================
# Setup XFCE autostart (first boot only)
# ============================================================================
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
if [ ! -d "$AUTOSTART_DIR" ]; then
  log "Setting up XFCE autostart..."
  mkdir -p "$AUTOSTART_DIR"

  # Autostart terminal with shared tmux session
  cat > "$AUTOSTART_DIR/xfce4-terminal.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Terminal
Exec=xfce4-terminal -e "tmux new-session -A -s main bash"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
AUTOSTART_EOF

  # Autostart Claude Code UI in browser
  cat > "$AUTOSTART_DIR/claude-code-ui.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Claude Code UI
Exec=firefox http://localhost/ui
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupDelay=5
AUTOSTART_EOF

  # Autostart File Manager in browser
  cat > "$AUTOSTART_DIR/file-manager.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=File Manager
Exec=firefox http://localhost/files
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupDelay=5
AUTOSTART_EOF

  chown -R abc:abc "$AUTOSTART_DIR"
  log "✓ XFCE autostart configured"
else
  log "✓ XFCE autostart already configured (skipping)"
fi

# ============================================================================
# Start supervisor
# ============================================================================
log "Starting gmweb supervisor..."

# Export HOME for supervisor
export HOME="$HOME_DIR"

if [ -f /opt/gmweb-startup/start.sh ]; then
  bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
else
  log "ERROR: start.sh not found at /opt/gmweb-startup/start.sh"
  exit 1
fi

# Check for user startup hook
if [ -f "$HOME_DIR/startup.sh" ]; then
  log "Running user startup hook..."
  bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"
  log "User startup hook completed"
fi

log "===== GMWEB STARTUP COMPLETE ====="
exit 0
