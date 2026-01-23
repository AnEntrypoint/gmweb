# Technical Caveats & Gotchas

## Core Architecture

### LinuxServer Webtop + nginx + Selkies

**Base Image:** `lscr.io/linuxserver/webtop:ubuntu-xfce`

- Webtop web UI listens on port 3000 internally (CUSTOM_PORT=6901 is external config only)
- nginx listens on ports 80/443 (HTTP/HTTPS with HTTP Basic Auth reverse proxy, pre-installed in LinuxServer)
- Selkies WebSocket streaming on port 8082
- OpenCode web editor on port 9997 (configured via supervisor service)
- Traefik/Coolify routes external domain to container:80

**Port 80/443:** nginx provides the primary entry point with built-in HTTP Basic Auth. Port 80 routes to Webtop:3000 for main interface and Selkies:8082 for desktop streaming. All other web services routed by path prefix.

### nginx Implementation

**Critical constraint:** nginx is pre-installed in LinuxServer Webtop base image.

- Configuration: Static template at `docker/nginx-sites-enabled-default`
- Routes `/desk/websockets?` to Selkies WebSocket at `127.0.0.1:8082`
- Routes `/desk/` to Selkies web UI at `/usr/share/selkies/web/`
- Routes `/desk/files` to file browser
- Routes `/devmode` to development server (port 5173)
- Routes `/ui/` and `/api/` to OpenCode (port 9997)
- Routes `/ws/` to WebSocket proxy for real-time services

**Why static nginx config:** nginx pre-installed, no additional process management needed, supports HTTP/1.1 upgrades and WebSocket proxying, HTTPS via Traefik/Let's Encrypt.

### Environment Variables

**PASSWORD (CRITICAL):**
- LinuxServer uses PASSWORD, not VNC_PW
- Generates HTTP Basic Auth credentials (`abc:PASSWORD`)
- nginx htpasswd file generated at startup
- All services receive PASSWORD via environment

**CUSTOM_PORT:**
- External configuration only (6901 for direct VNC if needed)
- Internal Webtop always listens on port 3000
- Setting CUSTOM_PORT does NOT change internal routing

## Startup System

### Service Startup Order

1. **nginx** - Starts automatically by LinuxServer s6 supervision system
2. **Desktop services** (xorg, xfce, selkies) - Started by s6
3. **gmweb supervisor** - Started via `/custom-cont-init.d/01-gmweb-init`
4. **Additional services** - Started by gmweb supervisor

**Critical:** nginx handles HTTP/HTTPS with Basic Auth before any other services. All endpoints protected.

### Init Script Must Exit

**GOTCHA:** The `/custom-cont-init.d/01-gmweb-init` script MUST exit (not infinite loop). If it blocks, s6-rc never proceeds to start desktop services (xorg, xfce, selkies).

**Why:** LinuxServer's s6 init system waits for custom init to complete. Blocking prevents desktop environment from launching.

## Critical Technical Caveats

### Port Forwarding Caveat

**GOTCHA:** CUSTOM_PORT is external only. Internal routing uses hardcoded ports:
- `/desk/*` → port 8082 (Selkies)
- All other routes → port 3000 (Webtop)

Using `parseInt(process.env.CUSTOM_PORT)` for upstream routing will send traffic to wrong port (6901 instead of 3000).

### Supervisor Health Check

**GOTCHA:** Health check must reference enabled services. Checking disabled services causes health check to never detect supervisor (2-minute startup timeout).

### Supervisor Initialization Blocking

**GOTCHA:** The `monitorHealth()` function is infinite loop. If awaited in `supervisor.start()`, init hangs forever.

**Fix:** Run `monitorHealth()` as fire-and-forget background task. Use `await new Promise(() => {})` to block supervisor startup properly without awaiting infinite loop.

### nginx Path Stripping with Regex

**CRITICAL CONSTRAINT:** nginx cannot use `proxy_pass` with URI part in regex locations.

**Error:** `"proxy_pass" cannot have URI part in location given by regular expression`

**Workaround:** Use `rewrite` directive before proxy_pass:
```nginx
location ~ /desk/websockets? {
  rewrite ^/desk/websockets?(.*) $1 break;
  proxy_pass http://127.0.0.1:8082;  # No URI part - rewrite stripped it
}
```

### Selkies WebSocket Endpoints

**GOTCHA:** Selkies client attempts both `/desk/websocket` (singular) and `/desk/websockets` (plural).

**Before fix:** nginx only had `location /desk/websocket` (singular) - plural requests failed.

**After fix:** Use regex `location ~ /desk/websockets?` to match both. Use rewrite to strip path, then proxy to bare port (no URI).

### Docker Build Performance

**CRITICAL:** Dockerfile no longer installs anything at build time. All tool installations deferred to runtime via `custom_startup.sh`.

**Why:** Build time reduced from 4+ minutes to ~2 seconds. Image size reduced 5.17GB → 4.15GB. Cache-friendly for config changes.

**Implication:** Every container startup re-runs installation checks. First boot does installs (NVM, Node, packages). Subsequent boots use cache (fast). If install fails, system keeps running (background process).

**Startup phases (custom_startup.sh):**
1. Quick init: Permissions, paths, config (instant)
2. Node.js: Install if not present (1st boot)
3. Supervisor: Fetch repo, npm install (1st boot)
4. Start supervisor: Service manager (every boot)
5. Background installs: System packages + tools (non-blocking)
   - nginx/desktop ready immediately
   - Tools install while UI available
   - Tool failures don't crash system

### Persistent Volume Log Caching

**GOTCHA:** Old logs in persistent `/config/logs` volume are cached across container restarts. Reading log file shows stale data from previous deployment.

**Example:** start.sh shows first 30 lines (old boot logs), not last 50 lines (new boot logs).

**Caveat:** Cannot determine if new code actually executed without boot timestamp verification.

### sshd Disabled in Favor of webssh2

**Note:** sshd service disabled (commit 47795d9). webssh2 provides SSH via web browser, reduces attack surface by avoiding direct SSH port exposure. All traffic through nginx HTTP/HTTPS with Basic Auth.

