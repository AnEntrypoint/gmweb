# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + kasmproxy-wrapper + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

**Architecture:**
- Webtop web UI listens on port 3000 internally (CUSTOM_PORT=6901)
- kasmproxy-wrapper listens on port 80 (HTTP Basic Auth reverse proxy)
- Selkies WebSocket streaming on port 8082 (handles own authentication)
- Traefik/Coolify handles external HTTPS via domain assignment

**Critical:** Port 80 is internal only - DO NOT expose to host. Traefik routes domain to container, which handles port 80 internally.

### Environment Variables (PASSWORD)

- **Use PASSWORD** (not VNC_PW) - native to LinuxServer Webtop
- Supervisor reads PASSWORD from container environment
- All services receive PASSWORD via explicit env object:
  ```javascript
  const child = spawn(cmd, args, {
    env: { ...process.env, PASSWORD: env.PASSWORD || 'password' }
  });
  ```
- Do NOT use template string injection

## Startup System

### Supervisor Configuration (config.json)

**CRITICAL:** Old kasmproxy service must be explicitly disabled:
```json
{
  "services": {
    "kasmproxy": { "enabled": false },
    "kasmproxy-wrapper": { "enabled": true, "type": "critical", "requiresDesktop": false }
  }
}
```

**Why:** In Webtop architecture, `kasmproxy-wrapper` on port 80 is the ONLY reverse proxy. If both services try to start, conflicts occur.

### kasmproxy-wrapper Prioritization

- Must start FIRST (critical path) - it's the external entry point on port 80
- Supervisor blocks other services until kasmproxy-wrapper is healthy
- Health check: `lsof -i :80 | grep LISTEN`
- Timeout: 2 minutes, then continues
- **Why critical:** All external access goes through port 80. If kasmproxy-wrapper fails, nothing is accessible

### Health Check Pattern (Critical)

**Always use `grep LISTEN` not process name:**

Node processes spawned via `npx` show as `MainThrea` in `lsof`, not `node`.

**Correct:**
```bash
lsof -i :9998 | grep -q LISTEN
```

**Wrong:**
```bash
lsof -i :9998 | grep -q node  # FAILS
```

## kasmproxy-wrapper Runtime Behavior

### Service Configuration

**Input:** HTTP requests with optional `/desk/` prefix

**Processing:**
1. Check if route requires auth (skip for `/data/*` and `/ws/*`)
2. Strip SUBFOLDER prefix (`/desk/` → empty)
3. Route based on path:
   - `/data/*` or `/ws/*` → port 8082 (Selkies) - no auth
   - Everything else → port 3000 (Webtop) - requires auth

**Output:**
- For HTTP: Forward request with stripped path to upstream
- For WebSocket: Upgrade and pipe bidirectionally to upstream

### Authentication (HTTP Basic Auth)

**Credentials:**
- Username: `kasm_user` (hardcoded)
- Password: Value from `PASSWORD` environment variable

**Auth Flow:**
1. kasmproxy-wrapper receives request with Authorization header
2. Decodes Base64: `kasm_user:PASSWORD`
3. Compares expected: `kasm_user:` + PASSWORD
4. 401 if mismatch, 200 if match

**Important:** Selkies routes (`,/data/*`, `/ws/*`) bypass kasmproxy-wrapper auth - Selkies handles its own authentication via VNC password in URL.

### SUBFOLDER Path Stripping

When `SUBFOLDER=/desk/` is set:
- `/desk/` becomes `/`
- `/desk/ui` becomes `/ui`
- `/desk/data/stream` becomes `/data/stream`

**Critical code path:**
1. Call `stripSubfolder(req.url)` early
2. Use stripped `path` when forwarding to upstream (NOT raw `req.url`)
3. WebSocket handler: strip BEFORE auth checks for correct route matching

**Bug symptom:** Requests forwarded with raw `req.url` → upstream gets `/desk/data` → returns 404/502.

## Port Architecture

**Internal (container only):**
- 80: kasmproxy-wrapper (reverse proxy)
  - Routes to 3000 or 8082 based on path
- 3000: Webtop web UI (HTML interface)
- 8082: Selkies WebSocket (desktop streaming)

**External (via Traefik/Coolify):**
- Domain → Traefik → container port 80 → kasmproxy-wrapper
- No direct port exposure (ports are internal)

## Supervisor & Services

### Module Interface (ES6)

Each service exports:
```javascript
export default {
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
- Failed services auto-restart with exponential backoff (5s → 60s max)
- Max restart attempts: 5, then marked unhealthy

### Environment Variable Passing

All services receive environment through child_process spawn:
```javascript
const processEnv = {
  ...env,
  PASSWORD: env.PASSWORD || 'password',
  CUSTOM_PORT: env.CUSTOM_PORT || '6901',
  SUBFOLDER: env.SUBFOLDER || '/desk/',
  PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
};
```

**Do NOT use:** Template string injection like `password=$PASSWORD` in shell commands.

### Startup Directories

- **Build time:** `install.sh` runs during docker build
- **Boot time:** `custom_startup.sh` runs at container startup
- **Supervisor:** `/opt/gmweb-startup/index.js` (lives forever, restarts services)
- **Logs:** `/config/logs/` (supervisor.log + per-service logs)

## Known Technical Issues & Solutions

### Issue: kasmproxy Service Not Disabled

**Symptom:** Port 80 doesn't listen, HTTP 502 on all requests

**Cause:** Both kasmproxy and kasmproxy-wrapper try to start, conflict occurs

**Solution:** Ensure config.json has `"kasmproxy": { "enabled": false }`

### Issue: Wrong Environment Variable Name

**Symptom:** Auth fails even with correct password

**Cause:** Code uses VNC_PW instead of PASSWORD (or vice versa)

**Solution:** Use PASSWORD only for Webtop. Supervisor passes PASSWORD to all services.

### Issue: SUBFOLDER Path Not Stripped

**Symptom:** Upstream services get `/desk/data` instead of `/data`, return 404

**Cause:** Raw `req.url` used instead of stripped `path` variable

**Solution:** Call `stripSubfolder(req.url)` first, use result when forwarding.

### Issue: Health Check Fails for npx Processes

**Symptom:** Service appears crashed but is actually running

**Cause:** `lsof | grep node` doesn't match npx process name (shows `MainThrea`)

**Solution:** Use `lsof -i :PORT | grep LISTEN` instead of process name matching.

## Deployment Prerequisites

**Before Coolify deployment:**
1. Set environment variable: `PASSWORD=<strong-password>`
2. Ensure supervisor config has kasmproxy disabled
3. Ensure kasmproxy-wrapper service is enabled
4. All commits pushed to GitHub (Dockerfile clones from repo)

**After Coolify deployment:**
1. Assign domain in Coolify UI (e.g., `desk.acc.l-inc.co.za`)
2. Traefik automatically creates routing rules
3. HTTPS auto-provisioned by Let's Encrypt

**Access credentials:**
- Username: `kasm_user`
- Password: Value of PASSWORD environment variable
