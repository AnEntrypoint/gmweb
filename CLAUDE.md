# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + kasmproxy + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

**Architecture:**
- Webtop web UI listens on port 3000 internally (CUSTOM_PORT=6901 is external config only)
- kasmproxy listens on port 8080 (HTTP Basic Auth reverse proxy, non-privileged port for abc user)
- Selkies WebSocket streaming on port 8082 (handles own authentication)
- Traefik/Coolify routes external domain to container:8080

**Port 8080:** kasmproxy runs as non-root user "abc" and cannot bind privileged ports (< 1024). Port 8080 is used instead. Traefik/Coolify routes external requests to container:8080. kasmproxy then routes internally to Webtop:3000 or Selkies:8082.

### kasmproxy Implementation (via gxe)

**Execution:** `npx -y gxe@latest AnEntrypoint/kasmproxy`

kasmproxy is executed via gxe, which fetches and runs the latest code from the AnEntrypoint/kasmproxy GitHub repository. This ensures the proxy always runs the latest version without manual updates.

**What it does:**
- Listens on port 8080 (non-privileged, can bind as abc user)
- Enforces HTTP Basic Auth (`kasm_user:PASSWORD`)
- Routes `/data/*` and `/ws/*` to Selkies:8082 (bypasses auth)
- Routes all other paths to Webtop:3000 (requires auth)
- Strips SUBFOLDER prefix (`/desk/*` → `/*`)

**Why Port 8080:**
The supervisor runs as non-root user "abc" (from LinuxServer Webtop). Non-root processes cannot bind privileged ports (< 1024) without special capabilities. Port 8080 allows kasmproxy to start without requiring CAP_NET_BIND_SERVICE. Traefik/Coolify forwards external traffic to this port.

**Why gxe Pattern:**
All AnEntrypoint projects run via gxe: `npx -y gxe@latest AnEntrypoint/<project>`. This ensures:
- Always fetch latest code from GitHub at startup
- No manual image rebuilds needed for project updates
- Automatic version management via gxe
- Consistent execution pattern across all AnEntrypoint projects

### Environment Variables

**PASSWORD (CRITICAL):**
- LinuxServer Webtop uses PASSWORD (not VNC_PW)
- Supervisor reads PASSWORD from container environment
- All services receive PASSWORD via explicit env object
- Must NOT use template string injection

**CUSTOM_PORT:**
- External configuration only (6901 for Webtop UI)
- Internal Webtop always listens on port 3000
- kasmproxy hardcodes upstream port (3000 or 8082) based on request path
- Setting CUSTOM_PORT does NOT change internal port routing

## Startup System

### Supervisor Configuration (config.json)

Only kasmproxy service is configured:
```json
{
  "services": {
    "kasmproxy": {
      "enabled": true,
      "type": "critical",
      "requiresDesktop": false
    }
  }
}
```

**CRITICAL:** kasmproxy must be `enabled: true` and `type: "critical"` to prioritize startup.

### kasmproxy Prioritization

- Starts FIRST (critical path) - external entry point on port 80
- Supervisor blocks other services until kasmproxy is healthy
- Health check: `lsof -i :80 | grep LISTEN`
- Timeout: 2 minutes max

### Supervisor Health Check Bug (FIXED - 30677ec)

**Original Bug:** `waitForKasmproxyHealthy()` was checking hardcoded `kasmproxy` service instead of actual proxy service name.

**Impact:** 2-minute startup delay while waiting for wrong service.

**Fix:** Pass actual service name to health check function.

```javascript
// Before (WRONG)
const kasmproxy = this.services.get('kasmproxy');

// After (CORRECT)
const proxy = this.services.get(serviceName);
```

## Critical Fixes Applied

### 4. Persistent Volume Log Caching (Commit 29911a7)

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
4. Added kasmproxy port 8080 listening verification - detects silent startup failures

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

### 3. Authentication Isolation

kasmproxy deletes Authorization header before forwarding upstream. This prevents double-authentication and ensures upstream services never see credentials.

```javascript
delete headers.authorization;
headers.host = `localhost:${upstreamPort}`;
```

## Deployment

### Docker Build

Dockerfile clones gmweb repo from GitHub to `/opt/gmweb-startup` during build. Startup system files are in container at `/opt/gmweb-startup/`.

### Coolify Integration

- Coolify automatically forwards domain requests to container port 80
- HTTPS auto-provisioned by Let's Encrypt
- No additional port configuration needed in compose file
- Domain assignment in Coolify UI is required for external access

### Supervisor Not Starting (Blocker - Investigation Complete)

**Status:** Supervisor process backgrounded via nohup in start.sh but fails to execute or produce output.

**Verified Facts:**
- Container starts successfully and runs indefinitely (no crashes)
- STARTUP COMPLETE message appears in logs
- Selkies on port 8082 starts and functions correctly
- NO supervisor logs appear anywhere (not in docker logs, supervisor.log, or startup.log)
- NO kasmproxy logs appear
- Endpoint returns HTTP 502 (no service listening on port 80)

**Root Cause:** When supervisor is backgrounded with `nohup "$NODE_BIN" /opt/gmweb-startup/index.js > "$LOG_DIR/supervisor.log" 2>&1 &` in start.sh:
- The nohup background job appears to succeed (no error message)
- But the supervisor process never actually starts or its output is not being captured
- The supervisor.log file never appears
- No output reaches docker logs

**Theories:**
1. Nohup background job exits immediately (unnoticed by start.sh which returns 0)
2. Output file redirection fails silently (/config/logs may not have write permissions at runtime)
3. Node.js path or supervisor code path is incorrect in container
4. Environmental variables (HOME, PATH) cause supervisor to fail during startup

**Changes Made:**
- Added diagnostics to start.sh (not effective - supervisor still fails)
- Simplified start.sh to remove exit codes (needed to prevent container from exiting)
- Added error logging to custom_startup.sh (no errors captured)

**RESOLVED - Two Critical Issues Fixed:**

### Issue 1: supervisor.start() Infinite Loop (Commit 9861a62)
**Problem:** The `monitorHealth()` function is an infinite loop that was being awaited in `supervisor.start()`:
```javascript
// OLD - BLOCKS FOREVER:
await this.monitorHealth();  // Never returns - infinite loop
```

**Impact:** supervisor.start() never completed, so supervisor initialization hung indefinitely. Custom_startup.sh would complete but no services actually started.

**Fix:** Run monitorHealth() as fire-and-forget background task and keep start() alive properly:
```javascript
// NEW - WORKS:
this.monitorHealth().catch(err => this.log('ERROR', 'Health monitoring crashed', err));
await new Promise(() => {});  // Never resolves - blocks forever in proper way
```

**Critical Detail:** The `await new Promise(() => {})` blocks start() forever (correct behavior for immortal supervisor), but doesn't block initialization (monitorHealth runs in background).

### Issue 2: kasmproxy Port 80 Binding Failure (Commit b24e959)
**Problem:** kasmproxy was configured to listen on port 80 (privileged port):
- LinuxServer Webtop runs services as non-root user `abc`
- Non-root processes cannot bind privileged ports (< 1024) without CAP_NET_BIND_SERVICE
- kasmproxy failed to start silently on port 80
- Health check failed → HTTP 502 errors

**Fix:** Changed kasmproxy to listen on port 8080 (non-privileged):
```javascript
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || '8080');
```
- User `abc` can now successfully bind port 8080
- Traefik/Coolify routes external traffic to container:8080
- All internal services continue working

**Summary:** Both fixes ensure supervisor initializes correctly and kasmproxy can start on a non-privileged port.

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

### Claude Code UI (Commits 06515b3, eeb0810)

**Decision:** Claude Code UI removed completely - not needed for gmweb purpose.

**Removal:**
- Deleted `startup/services/claude-code-ui.js`
- Removed from `startup/index.js` serviceNames array
- Removed installation from `startup/install.sh`
- Removed autostart desktop entry from `docker/custom_startup.sh`
- Removed from `startup/config.json`

**Rationale:** Claude Code UI was causing service bloat. The focus is on Claude Code CLI and kasmproxy as the primary entry point. No database persistence needed.
