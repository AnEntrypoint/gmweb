# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + kasmproxy + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

**Architecture:**
- Webtop web UI listens on port 3000 internally (CUSTOM_PORT=6901 is external config only)
- kasmproxy listens on port 80 (HTTP Basic Auth reverse proxy)
- Selkies WebSocket streaming on port 8082 (handles own authentication)
- Traefik/Coolify routes external domain to container:80

**Port 80:** Internal only. Coolify automatically forwards domain requests to container port 80. kasmproxy then routes internally to Webtop:3000 or Selkies:8082.

### kasmproxy Implementation

**Execution:** Direct Node.js: `node /opt/gmweb-startup/kasmproxy.js`

Kasmproxy is a local HTTP reverse proxy implementation that:
- Listens on port 80
- Enforces HTTP Basic Auth (`kasm_user:PASSWORD`)
- Routes `/data/*` and `/ws/*` to Selkies:8082 (bypasses auth)
- Routes all other paths to Webtop:3000 (requires auth)
- Strips SUBFOLDER prefix (`/desk/*` → `/*`)

**Why Local Implementation:**
gxe execution via `npx -y gxe@latest AnEntrypoint/kasmproxy` was unreliable. Local Node.js execution ensures kasmproxy starts and binds to port 80 consistently.

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

**Unresolved:** The supervisor process initialization is failing silently. Cannot proceed without resolving why nohup is not executing the Node.js supervisor properly.
