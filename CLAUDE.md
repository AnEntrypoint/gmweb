# Technical Caveats & Gotchas

## LinuxServer Webtop Integration

### Base Image
Uses `lscr.io/linuxserver/webtop:ubuntu-xfce` instead of KasmWeb.

**Key differences from KasmWeb:**
- Home directory: `/config` (not `/home/kasm-user`)
- Default user: `abc` (not `kasm-user`)
- Web UI port: 6901 (set via `CUSTOM_PORT=6901` environment variable)
- HTTPS port: 6902 (set via `CUSTOM_HTTPS_PORT=6902`)
- Init mechanism: `/custom-cont-init.d/` scripts
- Environment: `PASSWORD` (also accepts `VNC_PW` for compatibility)

### Environment Variables (LinuxServer Webtop)
**Critical for port configuration:**
- `CUSTOM_PORT=6901` - Internal HTTP port (DO NOT use 80, reserved for kasmproxy-wrapper)
- `CUSTOM_HTTPS_PORT=6902` - Internal HTTPS port (automatically CUSTOM_PORT+1)
- `FILE_MANAGER_PATH=/config/Desktop` - Where webtop file uploads/downloads go
- `PASSWORD` or `VNC_PW` - HTTP Basic auth password
- `CUSTOM_USER` - HTTP Basic auth username (default: abc)

### Dynamic Path Resolution
All services use dynamic paths to support both webtop and legacy configurations:
```javascript
const HOME_DIR = process.env.HOME || '/config';
const WEBTOP_USER = process.env.SUDO_USER || 'abc';
```

## Runtime-Driven Startup Architecture

### Build-Time System Setup
- **install.sh** runs at `docker-compose build` time (one-time setup)
  - All system packages, software installation
  - Runs as ROOT during Dockerfile RUN command
  - Must NOT create anything in `/config`
  - Output captured by docker build

- **Startup system location: `/opt/gmweb-startup`**
  - Supervisor (index.js), start.sh, service modules
  - Located in system-level directory
  - All references point to `/opt/gmweb-startup` in Dockerfile

### Boot-Time Runtime Startup
- **LinuxServer init mechanism:** `/custom-cont-init.d/01-gmweb-init`
  - Runs automatically at container boot
  - Calls `/opt/gmweb-startup/custom_startup.sh`
  - Sets up user-specific configuration
  - Launches supervisor in background

- **custom_startup.sh** orchestrator
  - Sets up user-specific configuration (first boot only)
  - Calls start.sh (supervisor launcher)
  - Optionally calls user's `/config/startup.sh` hook if present

### Supervisor Kasmproxy Prioritization
- Kasmproxy **MUST** start FIRST (critical path)
- Supervisor blocks all other services until kasmproxy is healthy
- Health check: verifies port 80 is listening via `lsof -i :80`
- Timeout: 2 minutes max wait, then continues anyway

### Environment Variable Passing
- Supervisor extracts PASSWORD/VNC_PW from container environment via `/proc/1/environ`
- All services receive environment through `process.env` in node child_process spawn
- **Critical:** Do NOT use template string injection - use explicit env object:
  ```javascript
  const child = spawn(cmd, args, {
    env: { ...process.env, CUSTOM_VAR: value }
  });
  ```

### User Startup Hook Support
- If `/config/startup.sh` exists, custom_startup.sh will execute it
- Called with `bash /config/startup.sh` (no executable bit needed)
- Allows users to add custom boot-time logic without code changes

### Service Module Interface
Each service exports standard interface:
```javascript
{
  name: 'service-name',
  type: 'critical|install|web|system',
  requiresDesktop: true|false,
  dependencies: ['other-service'],
  health: async () => boolean,
  start: async (env) => { pid, process, cleanup },
  stop: async (handle) => void
}
```

- Dependency resolution via topological sort (prevents circular deps)
- Health checks every 30 seconds

### Health Check Pattern (Critical)
**Always use `grep LISTEN` not process name in health checks.**

Node processes spawned via `npx` show as `MainThrea` in `lsof`, not `node`.

**Correct pattern:**
```bash
lsof -i :9998 | grep -q LISTEN
```

**Wrong pattern:**
```bash
lsof -i :9998 | grep -q node  # FAILS - process shows as MainThrea
```

### Immortal Supervisor Guarantees
- **Never crashes**: Global error handlers (uncaughtException, unhandledRejection)
- **Always recovers**: Failed services auto-restart with exponential backoff (5s → 60s max)
- **No mocks/fakes**: All child processes are real, all health checks are real
- **Self-healing**: Continuous monitoring loop with recovery on failure
- **Graceful degradation**: Service max restart attempts = 5, then marked unhealthy but supervisor continues

### Dockerfile Build Process
- Clones gmweb repo from GitHub during build
- Installs: git, NVM, Node.js 23.11.1
- Runs `bash install.sh` at build time for system packages
- Copies startup system to `/opt/gmweb-startup`
- Creates `/custom-cont-init.d/01-gmweb-init` for LinuxServer init

### Dockerfile Clones From GitHub (Critical)
**Important:** Dockerfile clones the repo instead of copying build context:
```dockerfile
RUN git clone https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb && \
    cp -r /tmp/gmweb/startup /opt/gmweb-startup && \
    rm -rf /tmp/gmweb
```

**Why:** Startup files are only available if cloned from GitHub. Works reliably in Coolify and other CI/CD systems.

### Deployment Infrastructure (Coolify)
**Important:** Code is production-ready but deployment requires Coolify domain assignment:
1. Code: All tests pass, all commits pushed, Docker builds cleanly
2. Infrastructure: Requires manual Coolify UI action to assign domain
3. Traefik routing: Auto-generated by Coolify when domain assigned
4. HTTPS: Auto-provisioned by Let's Encrypt (via Coolify)

Without domain assignment in Coolify UI, service returns 502.

## /opt Directory Ownership Pattern

### Root-Owned at Build, User-Owned at Boot
Applications installed to `/opt/` during docker build are owned by root. Services running as abc need write access.

**Pattern:** Add `chown -R abc:abc /opt/<app>` to `custom_startup.sh`

### Port Architecture
**Internal service ports (never expose externally):**
- 80: kasmproxy-wrapper (reverse proxy, forwards to below services)
- 8080: kasmproxy (authentication middleware)
- 6901: Webtop HTTP (CUSTOM_PORT)
- 6902: Webtop HTTPS (CUSTOM_HTTPS_PORT)
- 9997: Claude Code UI
- 9998: file-manager (standalone)
- 9999: webssh2/ttyd (terminal)

**kasmproxy-wrapper routing (on port 80):**
- `/ui` → port 9997 (Claude Code UI) - path stripped to `/`
- `/api` → port 9997 (Claude Code UI API) - path kept as-is
- `/ws` → port 9997 (Claude Code UI WebSocket) - path kept as-is
- `/files` → port 9998 (standalone file-manager) - path stripped to `/`, **public (no auth)**
- `/ssh` → port 9999 (ttyd terminal) - path stripped to `/`
- `/websockify` → port 6901 (Webtop VNC WebSocket) - direct proxy
- `/` → port 6901 (Webtop web UI)

**WebSocket Upgrade Handling:**
The kasmproxy-wrapper handles WebSocket upgrades for `/websockify` and `/ssh/ws` by forwarding the 101 Switching Protocols response and establishing bidirectional piping.

**HTML Rewriting:** For `/ui` only, absolute paths like `/assets/`, `/icons/`, and `/favicon` are rewritten to `/ui/assets/`, `/ui/icons/`, etc.

**Authentication:**
- Claude Code UI (port 9997) has its own authentication - kasmproxy skips basic auth for `/ui`, `/api`, `/ws`
- File manager (`/files`) is public - no authentication required
- All other routes require HTTP Basic Auth with `VNC_PW`/`PASSWORD`

### Claude Code UI Basename Fix (Critical)
When Claude Code UI is accessed via `/ui` prefix, React Router needs a `basename` prop.

**Fix:** `install.sh` patches `App.jsx` after cloning to add:
```javascript
function getBasename() {
  const path = window.location.pathname;
  if (path.startsWith('/ui')) return '/ui';
  return '/';
}
// Then: <Router basename={basename}>
```

## Terminal and Shell Configuration

### ttyd Color Terminal Support
For ttyd web terminal to display colors properly:
```javascript
spawn(ttydPath, ['-p', '9999', '-W', '-T', 'xterm-256color', 'tmux', 'new-session', '-A', '-s', 'main', 'bash'], {
  env: { ...env, TERM: 'xterm-256color' }
});
```

### Shared tmux Session (/ssh and GUI Terminal)
Both the `/ssh` web terminal and the XFCE GUI terminal share the same tmux session named "main":
- **ttyd (webssh2.js):** `tmux new-session -A -s main bash`
- **XFCE autostart:** `xfce4-terminal -e "tmux new-session -A -s main bash"`

### tmux Must Start bash Explicitly
The tmux command must explicitly specify `bash` as the shell to run.

**Why:** Without explicit `bash`, tmux uses the default shell which may not source `.bashrc`.

### Shell Functions vs Aliases for Argument Passing
When creating command shortcuts that need to pass arguments, use shell functions:

**Correct (function):**
```bash
ccode() { claude --dangerously-skip-permissions "$@"; }
```

## Claude Code Data Persistence

### Storage Locations for Volume Mounts
Claude Code stores user data across multiple directories:

| Path | Size | Content | Priority |
|------|------|---------|----------|
| `/config/.claude` | ~19M | Sessions, projects, plugins, credentials, history, todos, settings | **CRITICAL** |
| `/config/.claude.json` | ~12K | User preferences, startup count, auto-update settings | **CRITICAL** |
| `/config/.local/share/claude` | ~405M | CLI versions (e.g., 2.1.11, 2.1.12) | MEDIUM |

### Recommended Volume Configuration
```yaml
volumes:
  # Critical - entire config directory
  - gmweb-config:/config
```

## NVM Directory Ownership

### Build vs Boot Ownership Issue
NVM is installed during docker build as root. Services running as abc cannot write to NVM directories.

**Fix:** `custom_startup.sh` runs `sudo chown -R abc:abc /usr/local/local/nvm` at boot.

## Gemini CLI Installation

### Use npx Wrapper Instead of Global Install
Global npm install is unreliable. Use wrapper script:
```bash
#!/bin/bash
exec /usr/local/local/nvm/versions/node/v23.11.1/bin/npx -y @google/gemini-cli "$@"
```

## OpenCode-AI Installation

### Same npx Wrapper Pattern as Gemini
```bash
#!/bin/bash
exec /usr/local/local/nvm/versions/node/v23.11.1/bin/npx -y opencode-ai "$@"
```

## File Manager (Standalone Server)

### Lightweight HTTP File Server
Custom standalone Node.js HTTP server (`standalone-server.mjs`).

**Location:** `/opt/gmweb-startup/standalone-server.mjs`

**Features:**
- Zero external dependencies (pure Node.js)
- Directory listing with file/folder icons
- File downloads with proper MIME types
- Path traversal protection
- `/files` prefix support for kasmproxy routing

**Service startup:**
```javascript
spawn('node', ['/opt/gmweb-startup/standalone-server.mjs'], {
  env: { ...env, BASE_DIR: '/config', PORT: '9998', HOSTNAME: '0.0.0.0' }
});
```

## Supervisor Logging

### Per-Service Log Files
Supervisor creates separate log files for each service:

```
/config/logs/
├── supervisor.log           # Main orchestration log
├── startup.log              # Boot-time custom_startup.sh log
├── LOG_INDEX.txt            # Reference guide for log files
└── services/
    ├── <service-name>.log   # stdout/stderr for each service
    └── <service-name>.err   # stderr only (errors/warnings)
```

**Usage:**
- `tail -f supervisor.log` - Watch supervisor activity
- `tail -f services/*.log` - Watch all service output
- `grep ERROR *.log` - Find errors across all logs
