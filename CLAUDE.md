# Architecture & Philosophy

This document captures the architectural decisions, design philosophy, and critical gotchas for gmweb. The system is designed around principles of immediate startup, runtime installation, fresh cloning on every boot, and explicit recovery mechanisms.

## Design Philosophy

### Runtime Installation Over Build Time

The original build took 4+ minutes and produced a 5.17GB image. By deferring all tool installations (NVM, Node, npm packages, ttyd, SQLite modules) to container startup, we now have:
- Build time: ~2 seconds
- Image size: 4.15GB
- Cache-friendly: Config changes don't trigger rebuilds
- Resilience: Failed installs don't break the container; services retry via health checks
- Fresh state: Every container boot gets latest versions from remote

This is a philosophical commitment: **avoid the trap of stale cached state**. The image should be minimal; the container should be intelligent.

### Force-Fresh Clone on Every Boot

The `/opt/gmweb-startup/` directory persists across container restarts on the host filesystem. Without explicitly deleting and re-cloning from git, old code remains active even after git changes are deployed. This creates a dangerous illusion of freshness.

**Every boot must:**
1. Delete all startup files, services, configs from `/opt/gmweb-startup/`
2. Re-clone from git (minimal depth for speed)
3. Run fresh `npm install`
4. Regenerate authentication credentials

The only file preserved is `custom_startup.sh` itself (baked into Docker image), since overwriting a running script causes undefined behavior.

This prevents the most insidious category of bugs: *where the system appears to work but is running stale code*. Better to fail loudly on a bad git clone than silently run yesterday's code.

### Supervisor Startup Sequencing

Many services have external dependencies (GitHub downloads, large npm installs, database creation). Early designs blocked supervisor startup on these installs, causing container orchestration timeouts before supervisor even started.

**Solution:** Supervisor starts immediately after git clone (~30s), then background processes handle non-blocking installs. If an install fails, supervisor is already running; services discover missing dependencies via health checks and retry.

This is a **hierarchical resilience** pattern: block on fast operations (git clone, local npm install), non-block on slow operations. Services fail gracefully when dependencies are missing; don't let one slow install starve the entire boot sequence.

### Authentication as Architectural Layers

Single `PASSWORD` env var controls all system authentication, but implementation varies by layer:

**HTTP layer (nginx):** apr1-hashed password in `/etc/nginx/.htpasswd`. Protects all routes before any application runs.

**Process layer (supervisor):** PASSWORD environment variable passed to all child services. Each service can implement its own auth using this shared credential.

**Application layer (AionUI):** Password hashes stored in SQLite database. Credentials set at startup via bcrypt.

This layered approach means:
- Changing PASSWORD requires regenerating nginx htpasswd (supervisor does this after desktop ready)
- Each layer is independent; one doesn't depend on others being configured
- HTTP protection exists even if applications are broken
- Services inherit credentials via environment without needing file access

### Desktop as Separate Concern (Not Supervisor-Managed)

XFCE desktop environment (xfce4-session, xfwm4, xfce4-panel, xfdesktop) is started by LinuxServer's s6 service manager, not gmweb's supervisor.

This decoupling matters:
- Desktop startup is completely independent of supervisor health
- If supervisor crashes, desktop remains responsive (Selkies can still capture the display)
- Desktop issues (Oracle kernel close_range syscall failures) don't block web services
- No timeout coupling between desktop and supervisor

The alternative—managing desktop via supervisor—creates a single point of failure. Desktop hangs would block service startup. Instead, they're parallel concerns.

### Recovery Through Explicit Checkpoints

Rather than relying on transient retry loops, gmweb uses explicit checkpoints:

- **D-Bus socket:** Must exist before XFCE starts. Explicitly wait for it (up to 10 attempts).
- **X11 socket:** Indicates Xvfb is ready. Supervisor waits for it (60s timeout).
- **nginx listening:** Two-phase htpasswd generation: early generation for safety, re-generation after nginx confirms it's listening.
- **Port binding:** Health checks verify services actually bind to ports (webssh2 gets 3 retries with 500ms delays to account for ttyd startup lag).

Each checkpoint is a verifiable state, not just "wait a little longer."

## Technical Caveats

### Selkies Authentication - Disable nginx HTTP Basic Auth

**CRITICAL:** Selkies has built-in authentication. nginx `auth_basic` must be disabled for `/desk` location.

**Why:** nginx applies `auth_basic` globally before forwarding to Selkies. User sees 401 instead of Selkies login page.

**Fix:** In `/desk` location: `auth_basic off;` Selkies handles auth internally.

### startup/start.sh: Node.js Binary Resolution

**Issue:** start.sh tried `which node` without sourcing NVM. Node installed via NVM at `/config/nvm/versions/node/vX.X.X/bin/node`. Default fallback `/usr/local/bin/node` doesn't exist.

**Fix:** Source NVM before running `which node`. Unset `NPM_CONFIG_PREFIX` (from LinuxServer base image) which conflicts with NVM.

### startup/services/webssh2.js: Health Check Shell Pipes

**Issue:** Health check `lsof -i :9999 | grep LISTEN` requires shell interpretation. `execSync()` without `shell: true` treats pipe as literal string, fails.

**Fix:** Add `shell: true` flag. Add 3 retry attempts with 500ms delays (ttyd needs time to bind port).

### nginx Regex Locations: Cannot Use proxy_pass With URI

**Error:** `"proxy_pass" cannot have URI part in location given by regular expression`

**Why:** nginx syntax restriction. Regex locations can't combine with path rewriting in proxy_pass.

**Workaround:** Use `rewrite` directive to strip the path, then bare `proxy_pass`:
```nginx
location ~ /desk/websockets? {
  rewrite ^/desk/(.*) /$1 break;
  proxy_pass http://127.0.0.1:8082;
}
```

### Supervisor Async Patterns: monitorHealth() Must Not Block

**Issue:** `monitorHealth()` is infinite loop. If awaited in supervisor startup, init hangs forever.

**Fix:** Run as fire-and-forget background task using `Promise.resolve(monitorHealth())`. Use `await new Promise(() => {})` to block startup properly without awaiting infinite loop.

### Docker Persistent Volume Process Persistence

**CRITICAL:** On persistent volumes (`/config` and `/opt`), processes from previous container boots keep running after container restart. This causes port conflicts and stale service instances.

**Symptom:** After redeploy, multiple supervisor instances run simultaneously. Services fail with `EADDRINUSE` errors. Health checks fail because old processes hold ports.

**Root cause:** Container restart doesn't kill processes. When the container restarts, PID namespace is preserved if using `--pid=host` or similar configurations.

**Fix:** Phase 0 of `custom_startup.sh` kills ALL old gmweb processes before starting new ones:
```bash
sudo pkill -f "node.*supervisor.js"
sudo pkill -f "node.*/opt/gmweb-startup"
sudo pkill -f "ttyd.*9999"
sudo fuser -k 9997/tcp 9998/tcp 9999/tcp 25808/tcp
sleep 2
```

**Why this matters:** Without this, every redeploy compounds the problem - old services never die, new ones can't start, system degrades until manual intervention.

### Docker Persistent Volume Log Caching

**Caveat:** Old logs in `/config/logs` persist across container restarts. Reading logs shows stale data from previous boot.

**Implication:** Cannot verify "did my code change actually execute?" without checking boot timestamp.

### HTTP Basic Auth Race Condition

**Issue:** custom_startup.sh generates htpasswd BEFORE nginx starts. Later, supervisor regenerates it, but if PASSWORD changed mid-boot, htpasswd becomes stale.

**Fix:** Two-phase generation:
1. custom_startup.sh generates early (for race condition safety, even though nginx reload fails silently)
2. supervisor.js regenerates AFTER confirming nginx is listening

### npm Cache Permissions on Persistent Volumes

**Issue:** When `/config` persists across container restarts, npm cache from previous boots becomes root-owned. When the `abc` user runs npm, permission errors occur:
```
npm error syscall mkdir
npm error path /config/.gmweb/npm-cache/_cacache/index-v5/...
npm error errno EACCES
```

**Root Cause:** Previous startup scripts set up npm cache in `/config/.gmweb/npm-cache` but didn't clean it between boots. On persistent volumes, stale root-owned files accumulate. `chown` and `chmod` alone can't fix filesystem corruption across restarts.

**Fix - Three-Layer Defense:**

1. **Early Cleanup (Phase 0.75):** BEFORE NVM is installed, completely delete `/config/.gmweb/{npm-cache,npm-global}` and recreate with 777 permissions.
2. **Post-NVM Cleanup:** IMMEDIATELY after npm becomes available, delete cache again and run `npm cache clean --force`.
3. **Pre-Supervisor Cleanup:** Right before installing supervisor, clean npm cache one final time.

All npm install commands happen AFTER cleanup layers.

**Why 777 Permissions:** Temporary measure during boot. npm needs to create subdirectories and cache files as `abc` user. This is safer than trying to fix permissions after npm runs and creates files with restrictive defaults.

### NVM Bin Directory Permissions

**Issue:** Supervisor runs as `abc` user. NVM bin directory owned by dockremap with 755 (not writable).

**Fix:** After NVM install, run `chmod 777 $NVM_DIR/versions/node/vX.X.X/bin`

### ttyd Installation: apt-get vs GitHub Static Binaries

**Issue:** GitHub ARM64 static binary (ttyd.aarch64) segfaults on some systems. Binary is statically linked and may be incompatible with specific kernels or libc versions.

**Symptom:** webssh2 service starts but immediately crashes. `ttyd --version` causes segmentation fault. Health checks continuously fail.

**Fix:** Use apt-get for ttyd on all architectures instead of GitHub releases. Apt version (1.7.4) is dynamically linked with proper dependencies and is architecture-tested.

**Why apt-get is better:**
- Dynamically linked binaries compatible with host system
- No external download failures or GitHub API issues
- Architecture-specific packages tested by distribution maintainers
- Consistent behavior across x86_64 and ARM64

**Code:** `sudo apt-get install -y ttyd`

### close_range Syscall Shim (Oracle Kernels)

**Issue:** Old Oracle kernels lack `close_range()` syscall. XFCE process spawning fails with "Operation not permitted".

**Symptom:** XFCE components (panel, desktop, window manager) don't launch.

**Fix:** Create C shim that stubs `close_range()` with errno=38. Inject via `LD_PRELOAD`. XFCE falls back to alternative methods when syscall fails.

### Supervisor Promise.all() Blocking on Long-Running Installs

**Issue:** Services grouped by dependency. Supervisor does `await Promise.all(startPromises)` for each group. If ANY service hangs (e.g., gcloud downloading 1GB SDK), entire supervisor blocks forever.

**Fix:** Disable services with hang potential (wrangler, gcloud, scrot, chromium-ext, playwriter). Keep only essential services enabled.

### XFCE Launcher as Background Process

**Why:** Custom XFCE component launcher runs AFTER supervisor (not blocking it). Supervisor starts immediately; desktop components launch in parallel.

**Alternative rejected:** Managing XFCE via supervisor would couple desktop health to service startup. If desktop hangs, supervisor blocks. Parallel approach is more resilient.

## Configuration Reference

**Paths:** All runtime files in `/opt/gmweb-startup/` (cloned from git every boot). Persistent files in `/config/`.

**Ports:** nginx 80/443, Selkies 8082, webssh2 9999, file-manager 9998, AionUI 25808.

**Environment:** PASSWORD (all auth), AIONUI_PASSWORD (optional override), AIONUI_USERNAME (default: admin), CUSTOM_PORT (external only, doesn't change internal routing).

**Services:** webssh2, file-manager, opencode, aion-ui (enabled). wrangler, gcloud, scrot, chromium-ext, playwriter, glootie-oc, tmux (disabled).

**Logging:** `/config/logs/supervisor.log` (main log, rotated at 100MB). Per-service logs in `services/`. Archived logs named `*.archive-{timestamp}`.

## Service Architecture Details

**Supervisor:** Organizes services by dependency graph. Starts dependency groups sequentially; services within group start in parallel.

**Startup order:**
1. custom_startup.sh (D-Bus, nginx, permissions, Node.js)
2. s6-rc services (nginx, desktop environment, Selkies)
3. gmweb supervisor (web services)
4. Background installs (non-blocking: ttyd, npm packages)

**Health checks:** Run every 30s per service. Trigger restart on failure (up to 5 retries with exponential backoff).

**Service code location:** `/opt/gmweb-startup/services/*.js` (refreshed from git every boot).

## One-Time Setup: Moltbot

Moltbot (molt.bot workspace UI) disabled by default. To enable:
1. Set `"enabled": true` in `startup/config.json`
2. Optional: Set `MOLTBOT_PORT` env var (default 7890)
3. Optional: Update nginx location for different path
4. Restart container

Runs on port 7890, proxied to `/molt/`. See https://docs.molt.bot/ for configuration.

## PASSWORD Deployment Requirement

**CRITICAL:** The PASSWORD environment variable controls all system authentication. It MUST be set during container deployment.

**Default behavior:** If PASSWORD is not set, system defaults to literal string `"password"`.

**Deployment:**
```bash
# docker-compose: Set PASSWORD in environment
docker-compose -e PASSWORD=MySecurePassword up -d

# Or in docker-compose.yaml
environment:
  - PASSWORD=MySecurePassword

# Or docker run
docker run -e PASSWORD=MySecurePassword gmweb:latest
```

**Password hash generation:** During startup, PASSWORD is hashed with `openssl passwd -apr1` and written to `/etc/nginx/.htpasswd`. This protects all HTTP routes with HTTP Basic Auth before any application layer runs.

**Verification:** After deployment with new PASSWORD:
```bash
curl -u abc:MySecurePassword https://your-domain.com/files/  # Should succeed (200)
```

Without proper PASSWORD deployment, users will fail to authenticate even if services are running correctly.

## AgentGUI Multi-Agent Interface

AgentGUI is a multi-agent UI that allows interacting with Claude Code and OpenCode agents. It's served on the `/gm/` endpoint (port 9897 internally, proxied via nginx on `/gm/`).

### Configuration

AgentGUI reads the `BASE_URL` environment variable to determine its routing prefix. The service is configured in `startup/services/agentgui.js`:

```javascript
// Pass BASE_URL environment variable to agentgui server
const childEnv = {
  ...env,
  HOME: '/config',
  PORT: String(PORT),
  BASE_URL: '/gm',           // Router prefix for frontend
  HOT_RELOAD: 'false',       // Disable in production
  NODE_ENV: 'production'
};
```

**Important:** AgentGUI connects to itself (the server it's running on) via WebSocket and API calls. It is NOT an external service – it's self-contained. The `BASE_URL` variable tells the frontend JavaScript what prefix to use when making API calls.

### How It Works

1. **Frontend served from `/gm/`** – nginx proxies HTTP requests to agentgui server on port 9897
2. **Frontend makes API calls** – JavaScript uses `BASE_URL` variable injected at runtime: `window.__BASE_URL = '/gm'`
3. **WebSocket sync** – Frontend connects to `wss://localhost/gm/sync` for real-time updates
4. **ACP integration** – AgentGUI backend discovers and manages Claude Code / OpenCode ACP sessions

### Endpoint Summary

- **HTTP GET `/gm/`** – Serves the HTML interface (port 9897)
- **API `/gm/api/conversations`** – Get/create/list conversations
- **API `/gm/api/agents`** – Discover available agents (Claude Code, OpenCode)
- **WebSocket `/gm/sync`** – Real-time session sync and state recovery
- **API `/gm/api/sessions/*/stream-updates`** – Stream update events

### Disabled During Development

Previous versions had agentgui disabled because:
- Initial investigation thought it was hardcoded to external domain `buildesk.acc.l-inc.co.za`
- Actually, it was a misunderstanding – agentgui connects to itself via `BASE_URL` environment variable

**As of commit 71bf160:** AgentGUI is fully enabled and functional. It provides a multi-agent chat interface for interacting with Claude Code and OpenCode agents.

### Testing AgentGUI

```bash
# Verify agentgui process is running
ps aux | grep agentgui

# Test the /gm/ endpoint
curl -u abc:password http://localhost/gm/ | head -20

# Test agentgui API to discover agents
curl -u abc:password http://localhost/gm/api/agents

# Create a test conversation
curl -u abc:password -X POST http://localhost/gm/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"agentId":"claude-code","title":"Test"}' | head -5

# WebSocket connectivity can be tested from browser console:
# The frontend will establish sync connection automatically on page load
```

### Hot-Reload Disable Issue (Fixed)

**Problem:** AgentGUI frontend was injecting hot-reload WebSocket code even though `HOT_RELOAD=false` was set.

**Root Cause:** Environment variables set in bash command strings weren't being inherited by child processes (bunx/bun). The bash `-c` execution context doesn't properly propagate environment variables to spawned children.

**Fix:** Changed from bash string execution to direct process spawn with `env` object:
```javascript
// Before (broken):
spawn('bash', ['-c', `PORT=${PORT} HOT_RELOAD=false bunx --latest agentgui@latest`], { env: childEnv })

// After (fixed):
spawn('bunx', ['--latest', 'agentgui@latest'], { env: childEnv })
```

This ensures all environment variables in `childEnv` (including `HOT_RELOAD`, `BASE_URL`, `NODE_ENV`) are properly passed to the bunx/agentgui process.

**Verification:** After restart, `/gm/` page no longer includes hot-reload WebSocket injection and page functionality is fully enabled.

## Opencode Plugin Installation

gmweb is installed as an opencode plugin during startup (Phase 1.7) to enable Claude Code agent capabilities. The plugin installation flow:

### How It Works

1. **Directory Setup:** Create `~/.config/opencode/plugin` with proper ownership (abc:abc)
2. **Repository Copy:** Copy gmweb from `/opt/gmweb-startup` to plugin directory using tar (excludes `node_modules`, `.git`, logs)
3. **Permission Fixing:** Ensure abc user can read/write all plugin files
4. **Dependency Install:** Run `bun install` in the plugin directory to install dependencies

### Technical Details

**Copy Method:** Uses tar to exclude stale/large directories:
```bash
(cd /opt/gmweb-startup && tar --exclude='node_modules' --exclude='.git' \
  --exclude='*.log' --exclude='.bun' -cf - .) | \
  (cd "$OPENCODE_PLUGIN_DIR" && tar -xf -)
```

**Why tar over cp/rsync:**
- More reliable with complex exclude patterns
- Preserves file attributes during copy
- Atomic operation (pipe creates output as destination receives input)
- Works consistently across all systems (no rsync dependency)

**Permission Flow:**
- Plugin directory created with 755 (rwxr-xr-x)
- Files set to 660 (rw-rw---- group-readable)
- Directories set to 750 (rwxr-x---)
- Ensures abc user can execute scripts and access files

**Bun Install Execution:**
- Runs as abc user (not root) to avoid permission issues
- Sets BUN_INSTALL and PATH environment variables
- 120-second timeout to prevent hanging
- Non-blocking: if Bun install fails, startup continues (plugin can be manually installed later)

### Manual Plugin Installation

If plugin installation fails during startup, manually install with:
```bash
cd ~/.config/opencode/plugin
bun install
```

### Troubleshooting

**Problem:** Plugin directory doesn't exist or is empty
- **Cause:** /opt/gmweb-startup not found or copy failed
- **Fix:** Verify git clone completed successfully and /opt/gmweb-startup contains startup files

**Problem:** "bun install failed" warning
- **Cause:** Bun not available or permission issues
- **Fix:** Manually run `cd ~/.config/opencode/plugin && bun install` after container boots

**Problem:** Plugin files have wrong permissions
- **Cause:** tar copy preserved restrictive permissions from source
- **Fix:** Run `chmod -R u+rwX,g+rX,o-rwx ~/.config/opencode/plugin`
