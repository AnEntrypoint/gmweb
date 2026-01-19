# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + kasmproxy + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

**Architecture:**
- Webtop web UI listens on port 3000 internally
- kasmproxy listens on port 80 (HTTP Basic Auth reverse proxy)
- Selkies WebSocket streaming on port 8082 (handles own authentication)
- Traefik/Coolify handles external HTTPS via domain assignment

**Port 80:** Internal only - NOT exposed to host. Traefik routes domain to container:80, kasmproxy internally routes to Webtop:3000 or Selkies:8082.

### kasmproxy Service Architecture

**Execution:** `npx -y gxe@latest AnEntrypoint/kasmproxy`

Kasmproxy is executed from the upstream GitHub repository (AnEntrypoint/kasmproxy) via gxe, eliminating need for local wrapper code.

**Routing Logic:**
- `/data/*` and `/ws/*` → Selkies:8082 (no auth required)
- All other routes → Webtop:3000 (requires HTTP Basic Auth)

**Authentication:**
- Enforced at port 80 (kasmproxy level)
- Credentials: `kasm_user:PASSWORD` (from container environment)
- Authorization header deleted before forwarding to upstream (no double-auth)

**SUBFOLDER Support:**
- Environment variable: `SUBFOLDER=/desk/`
- Strips prefix before routing: `/desk/ui` → `/ui` to upstream
- Allows running Webtop under path prefix

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

Only kasmproxy service is referenced:
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

**CRITICAL:** kasmproxy must be enabled and type must be "critical" to prioritize startup.

### kasmproxy Prioritization

- Must start FIRST (critical path) - it's the external entry point on port 80
- Supervisor blocks other services until kasmproxy is healthy
- Health check: `lsof -i :80 | grep LISTEN`
- Timeout: 2 minutes

### Supervisor Health Check Bug (FIXED)

**Original Bug:** Supervisor was checking wrong service name in health check.

**Fix Applied:** Supervisor now passes correct service name to `waitForKasmproxyHealthy()` function.

This prevents 2-minute startup delays when waiting for the wrong service.

## Critical Fixes

### Port Forwarding (05e09ed)

**Issue:** kasmproxy-wrapper was forwarding to `parseInt(process.env.CUSTOM_PORT)` which resolved to 6901 instead of 3000.

**Root Cause:** CUSTOM_PORT (6901) is external configuration for LinuxServer Webtop. Internal Webtop UI always listens on port 3000.

**Fix:** Hardcoded upstream port to 3000 (Webtop) or 8082 (Selkies) based on request path.

**Impact:** 401 Unauthorized errors resolved - requests now forward to correct port.

### Supervisor Service Name Check (30677ec)

**Issue:** Supervisor health check was looking for disabled 'kasmproxy' service when enabled 'kasmproxy-wrapper' was running.

**Fix:** Pass actual proxy service name to health check function.

**Impact:** Eliminated 2-minute startup timeout.

## Deployment Notes

### Docker Build Process

Dockerfile clones gmweb repo from GitHub to `/opt/gmweb-startup` during build. This ensures startup system is available in container.

### Coolify Integration

- Code is production-ready
- Deployment requires manual domain assignment in Coolify UI
- HTTPS is auto-provisioned by Let's Encrypt (via Coolify)
- Without domain assignment, service returns 502

### Verification

**Auth working indicators:**
- Unauthenticated requests: HTTP 401
- Wrong credentials: HTTP 401
- Correct credentials: HTTP 200 (or 502 if upstream not ready)

**Port binding verification:**
- `lsof -i :80 | grep LISTEN` should show kasmproxy listening
- Indicates kasmproxy started successfully
