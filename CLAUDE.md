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

### Docker Persistent Volume Log Caching

**Caveat:** Old logs in `/config/logs` persist across container restarts. Reading logs shows stale data from previous boot.

**Implication:** Cannot verify "did my code change actually execute?" without checking boot timestamp.

### HTTP Basic Auth Race Condition

**Issue:** custom_startup.sh generates htpasswd BEFORE nginx starts. Later, supervisor regenerates it, but if PASSWORD changed mid-boot, htpasswd becomes stale.

**Fix:** Two-phase generation:
1. custom_startup.sh generates early (for race condition safety, even though nginx reload fails silently)
2. supervisor.js regenerates AFTER confirming nginx is listening

### NVM Bin Directory Permissions

**Issue:** Supervisor runs as `abc` user. NVM bin directory owned by dockremap with 755 (not writable).

**Fix:** After NVM install, run `chmod 777 $NVM_DIR/versions/node/vX.X.X/bin`

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
