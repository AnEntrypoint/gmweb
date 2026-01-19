# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + nginx + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

**Architecture:**
- Webtop web UI listens on port 3000 internally (CUSTOM_PORT=6901 is external config only)
- nginx listens on ports 80/443 (HTTP/HTTPS with HTTP Basic Auth reverse proxy, pre-installed in LinuxServer)
- Selkies WebSocket streaming on port 8082 (handles own authentication)
- OpenCode web editor on port 9997 (configured via supervisor service)
- Traefik/Coolify routes external domain to container:80

**Port 80/443:** nginx provides the primary entry point with built-in HTTP Basic Auth. Port 80 is routed to Webtop:3000 for the main interface and to Selkies:8082 for desktop streaming. All other web services are routed based on path prefixes.

### nginx Implementation

**Configuration:** Static nginx.conf template copied during Docker build

nginx comes pre-installed with LinuxServer Webtop and is configured via `/etc/nginx/sites-enabled/default`. The configuration:
- Listens on ports 80 (HTTP) and 443 (HTTPS)
- Enforces HTTP Basic Auth globally on all routes
- Routes `/desk/` to Selkies web UI (`/usr/share/selkies/web/`)
- Routes `/desk/websocket` to Selkies WebSocket (`127.0.0.1:8082`)
- Routes `/desk/files` to file browser with fancy indexing
- Routes `/devmode` to development server (port 5173)
- Routes `/ui/` and `/api/` to OpenCode web interface (port 9997)
- Routes `/ws/` to WebSocket proxy for real-time services

**Why Static nginx Config:**
- nginx is pre-installed and stable in LinuxServer base image
- No additional process management or external dependencies needed
- Standard, well-understood web server configuration
- Automatic handling of HTTP/1.1 upgrades and WebSocket proxying
- Supports HTTPS with Let's Encrypt via Traefik

### Environment Variables

**PASSWORD (CRITICAL):**
- LinuxServer Webtop uses PASSWORD (not VNC_PW)
- Used to generate HTTP Basic Auth credentials (`abc:PASSWORD`)
- nginx htpasswd file generated at startup via `custom_startup.sh`
- All services receive PASSWORD via environment

**CUSTOM_PORT:**
- External configuration only (6901 for direct VNC access if needed)
- Internal Webtop always listens on port 3000
- nginx routes all traffic based on paths, not ports
- Setting CUSTOM_PORT does NOT change internal routing

## Startup System

### Supervisor Configuration (config.json)

All services are configured with their enabled status and type:
```json
{
  "services": {
    "proxypilot": {
      "enabled": true,
      "type": "critical",
      "requiresDesktop": true
    },
    "opencode-web": {
      "enabled": true,
      "type": "web"
    },
    // ... other services
  }
}
```

**Critical services** (`type: "critical"`) must start successfully or supervisor attempts recovery. **Web services** (`type: "web"`) are optional - failures don't block other services.

### Service Startup Order

1. **nginx** - Started automatically by LinuxServer s6 supervision system (pre-installed)
2. **Desktop services** (xorg, xfce, selkies) - Started by LinuxServer s6 supervision system
3. **gmweb supervisor** - Started via `/custom-cont-init.d/01-gmweb-init` by LinuxServer init
4. **Additional services** - Started by gmweb supervisor in topologically sorted order

nginx handles HTTP/HTTPS with Basic Auth before any other services run. This ensures all endpoints are protected.

### nginx Startup

- nginx is pre-installed in LinuxServer base image
- Listens on ports 80/443 immediately on container start
- Configuration file copied at `/opt/gmweb-startup/nginx-sites-enabled-default` 
- HTTP Basic Auth credentials generated at startup via custom_startup.sh
- No dependencies on supervisor - runs immediately

## Critical Fixes Applied

### 5. kasmproxy Removal - Migrated to nginx (Commits b0938ba - current)

**Decision:** Removed kasmproxy service completely in favor of LinuxServer's pre-installed nginx.

**Reason:** 
- kasmproxy required complex gxe/npx execution with unreliable npm caching
- nginx is already installed and proven stable in LinuxServer base image
- nginx configuration is simpler and more standard
- Eliminates dependency on external npm packages

**Implementation:** 
- nginx listens on ports 80/443 with HTTP Basic Auth
- Static configuration template at `docker/nginx-sites-enabled-default`
- Config copied to container during Docker build
- Authentication setup via htpasswd in custom_startup.sh

**Result:** More reliable, simpler architecture with fewer external dependencies.

### 6. Persistent Volume Log Caching (Commit 29911a7)

**Bug:** Old supervisor.log from persistent /config/logs volume was cached across deployments, masking fresh startup logs and preventing visibility into whether new code was executing.

**Root Cause:**
- Container restarts retain /config/logs from previous deployments
- start.sh showed HEAD (first 30 lines) - old logs, not new logs appended at end
- No boot timestamp to verify fresh vs stale deployment
- Impossible to tell if supervisor actually started with new code

**Fix:**
1. Clear supervisor.log on every boot (before supervisor starts) - `docker/custom_startup.sh`
2. Changed start.sh to show TAIL (last 50 lines) instead of HEAD - captures fresh startup
3. Added boot timestamp to all diagnostics - `[start.sh] === STARTUP DIAGNOSTICS (Boot: YYYY-MM-DD HH:MM:SS) ===`
4. Added port 80 listening verification - detects silent startup failures

**Result:** Fresh deployments are now visible - logs show current boot, not old cached data.

### 1. Port Forwarding (05e09ed)

**Bug:** Used `parseInt(process.env.CUSTOM_PORT)` for upstream routing → forwarded to port 6901 instead of 3000.

**Root Cause:** CUSTOM_PORT (6901) is external configuration. Internal Webtop UI always listens on port 3000.

**Fix:** Hardcoded ports based on path:
- `/data/*` and `/ws/*` → port 8082 (Selkies)
- All other routes → port 3000 (Webtop)

**Result:** 401 Unauthorized errors resolved.

### 2. Supervisor Health Check (30677ec)

**Bug:** Health check looked for disabled service, never detected enabled one.

**Fix:** Pass correct service name to health check.

**Result:** Eliminated 2-minute startup timeout.

### 1. Port Forwarding (05e09ed)

**Bug:** Used `parseInt(process.env.CUSTOM_PORT)` for upstream routing → forwarded to port 6901 instead of 3000.

**Root Cause:** CUSTOM_PORT (6901) is external configuration. Internal Webtop UI always listens on port 3000.

**Fix:** Hardcoded ports based on path:
- `/data/*` and `/ws/*` → port 8082 (Selkies)
- All other routes → port 3000 (Webtop)

**Result:** 401 Unauthorized errors resolved.

### 2. Supervisor Health Check (30677ec)

**Bug:** Health check looked for disabled service, never detected enabled one.

**Fix:** Pass correct service name to health check.

**Result:** Eliminated 2-minute startup timeout.

### 3. Init Script Blocking s6-rc Service Startup (Fixed)

**Problem:** The `start.sh` script had an infinite loop `while true; sleep 60` that blocked s6-rc from starting other services.

**Impact:** 
- LinuxServer s6 init system waits for `/custom-cont-init.d/01-gmweb-init` to complete
- Script never exited due to infinite loop
- Prevented svc-xorg, svc-de, svc-selkies from starting
- Webtop desktop environment never launched

**Root Cause:** Misguided attempt to keep the init script running. However:
- The supervisor is spawned as a background process (detached)
- The supervisor continues running independently
- The init script MUST exit to allow s6-rc to proceed
- Blocking prevents critical desktop services from starting

**Fix:** Changed script to exit after supervisor starts:
```bash
# OLD (WRONG):
while true; do
  sleep 60
done

# NEW (CORRECT):
echo "[start.sh] === STARTUP COMPLETE ==="
exit 0
```

**Result:** s6-rc now proceeds to start svc-xorg, svc-de, and other services after gmweb init completes.

### 4. Supervisor Initialization (Commit 9861a62)

**Problem:** The `monitorHealth()` function is an infinite loop that was being awaited in `supervisor.start()`:
```javascript
// OLD - BLOCKS FOREVER:
await this.monitorHealth();  // Never returns - infinite loop
```

**Impact:** supervisor.start() never completed, so supervisor initialization hung indefinitely.

**Fix:** Run monitorHealth() as fire-and-forget background task and keep start() alive properly:
```javascript
// NEW - WORKS:
this.monitorHealth().catch(err => this.log('ERROR', 'Health monitoring crashed', err));
await new Promise(() => {});  // Never resolves - blocks forever in proper way
```

**Result:** Supervisor initializes correctly and manages services independently.

## Deployment

### Docker Build

Dockerfile clones gmweb repo from GitHub to `/opt/gmweb-startup` during build. Startup system files are in container at `/opt/gmweb-startup/`. The nginx configuration template is copied from `docker/nginx-sites-enabled-default` to the container.

### Coolify Integration

- Coolify automatically forwards domain requests to container port 80
- HTTPS auto-provisioned by Let's Encrypt
- No additional port configuration needed in compose file
- Domain assignment in Coolify UI is required for external access

## Persistent Storage & User Settings

### Docker-Compose Volume

**gmweb-config** (`/config`):
- Home directory for user `abc` (UID 1000, GID 1000)
- Contains all Kasm Webtop desktop files, Desktop/, Downloads/
- Contains Claude Code settings in `~/.claude/` (history, plugins, MCP servers, sessions)
- Preserves `.bashrc` PATH configuration and marker files

### Claude Code Persistence (`~/.claude/`)

Automatically persisted by gmweb-config volume:
- Session history (history.jsonl)
- Project metadata and file history
- Plugin cache and MCP server configuration
- Settings and preferences (settings.json)
- Session plans and todos

## Services Removed

### kasmproxy Service (Commit b0938ba)

**Decision:** kasmproxy service removed completely in favor of LinuxServer's pre-installed nginx.

**Removal:**
- Deleted `startup/services/kasmproxy.js`
- Removed from `startup/index.js` serviceNames array
- Removed from `startup/config.json`

**Rationale:** kasmproxy required complex gxe/npx execution with unreliable npm caching. nginx provides a simpler, more reliable alternative that's already part of the LinuxServer base image.

### Claude Code UI (Commits 06515b3, eeb0810)

**Decision:** Claude Code UI removed completely - not needed for gmweb purpose.

**Removal:**
- Deleted `startup/services/claude-code-ui.js`
- Removed from `startup/index.js` serviceNames array
- Removed installation from `startup/install.sh`
- Removed autostart desktop entry from `docker/custom_startup.sh`
- Removed from `startup/config.json`

**Rationale:** Claude Code UI was causing service bloat. The focus is on Claude Code CLI and nginx as the primary entry point. No database persistence needed.
