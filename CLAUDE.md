# Technical Caveats & Gotchas

## KasmWeb Integration - Critical Principles

### DO NOT interfere with KasmWeb initialization
KasmWeb's profile setup is flawless and self-contained. Any attempt to pre-create directories, set permissions, or create symlinks in `/home/kasm-user` or `/home/kasm-default-profile` during build time will interfere with profile verification and cause startup failures.

**Rule: Let KasmWeb do its job unchanged.**

### .bashrc File Existence Matters (KasmWeb Profile Marker)
- KasmWeb checks if `.bashrc` exists to determine if user profile has been initialized
- If `.bashrc` exists at startup, KasmWeb skips default profile setup
- **NEVER create or modify `.bashrc` during build time**
- Only modify `.bashrc` at BOOT time in `custom_startup.sh` with first-boot detection

### Directory Structure: Build vs Boot Split
- **Build time (`install.sh`):** System packages ONLY (`/usr`, `/etc`, `/opt`)
  - Do NOT create anything in `/home/kasm-user`
  - Do NOT create anything in `/home/kasm-default-profile`
  - Do NOT modify `.bashrc`
  - Let Dockerfile ONLY handle system-level setup

- **Boot time (`custom_startup.sh`):** User-specific setup ONLY
  - Runs after KasmWeb completes profile initialization
  - Create config files, directories, application setup
  - Use first-boot marker files to prevent duplicate setup on restarts
  - Example marker: `/home/kasm-user/.gmweb-bashrc-setup` for .bashrc setup

### KasmWeb Manages These Automatically
KasmWeb will create these directories with correct permissions and symlinks:
- `/home/kasm-user/Desktop`
- `/home/kasm-user/Downloads`
- `/home/kasm-user/Uploads`
- `/home/kasm-user/Desktop/Downloads` (symlink → ../Downloads)
- `/home/kasm-user/Desktop/Uploads` (symlink → ../Uploads)

**Do NOT pre-create these. Do NOT create symlinks for these. Let KasmWeb handle it.**

## Runtime-Driven Startup Architecture

### Build-Time System Setup
- **install.sh** runs at `docker-compose build` time (one-time setup)
  - All system packages, software installation
  - Runs as ROOT during Dockerfile RUN command
  - Must NOT create anything in `/home/kasm-user`
  - Must NOT modify `.bashrc`
  - Output captured by docker build

- **Startup system location: `/opt/gmweb-startup`** (NOT `/home/kasm-user`)
  - Supervisor (index.js), start.sh, service modules
  - Located in system-level directory (safe from KasmWeb overwrites)
  - All references point to `/opt/gmweb-startup` in Dockerfile and custom_startup.sh

### Boot-Time Runtime Startup
- **start.sh** runs at container BOOT time (every restart)
  - Minimal launcher script (16 lines)
  - Nohups supervisor from `/opt/gmweb-startup/index.js` in background
  - Exits immediately to unblock KasmWeb initialization
  - Must NOT block or wait for anything

- **custom_startup.sh** orchestrator in `/dockerstartup/`
  - KasmWeb native hook that runs at boot (after profile verification)
  - Sets up user-specific configuration (first boot only)
  - Calls start.sh (supervisor launcher)
  - Optionally calls user's `/home/kasm-user/startup.sh` hook if present
  - Exits to allow KasmWeb desktop to continue initializing

**Critical:** custom_startup.sh must exit immediately. If it stays open, KasmWeb desktop initialization is blocked and container becomes unhealthy.

### Supervisor Kasmproxy Prioritization
- Kasmproxy (KasmWeb proxy) **MUST** start FIRST (critical path)
- Supervisor blocks all other 13 services until kasmproxy is healthy
- Health check: verifies port 8000 is listening via `lsof -i :8000`
- Timeout: 2 minutes max wait, then continues anyway
- This ensures service becomes available ASAP (5-10 seconds from boot)

### Environment Variable Passing
- Supervisor extracts VNC_PW from container environment via `/proc/1/environ`
- All services receive environment through `process.env` in node child_process spawn
- **Critical:** Do NOT use template string injection - use explicit env object:
  ```javascript
  const child = spawn(cmd, args, {
    env: { ...process.env, CUSTOM_VAR: value }
  });
  ```
- Services inherit both parent environment AND explicitly set variables

### User Startup Hook Support
- If `/home/kasm-user/startup.sh` exists, custom_startup.sh will execute it
- Called with `bash /home/kasm-user/startup.sh` (no executable bit needed)
- Allows users to add custom boot-time logic without code changes
- Example: Start additional background services, configure dynamic settings

### Service Module Interface
Each of 14 services exports standard interface:
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

- Services with `requiresDesktop: true` wait for `/usr/bin/desktop_ready`
- Dependency resolution via topological sort (prevents circular deps)
- Health checks every 30 seconds

### Immortal Supervisor Guarantees
- **Never crashes**: Global error handlers (uncaughtException, unhandledRejection)
- **Always recovers**: Failed services auto-restart with exponential backoff (5s → 60s max)
- **No mocks/fakes**: All child processes are real, all health checks are real
- **Self-healing**: Continuous monitoring loop with recovery on failure
- **Graceful degradation**: Service max restart attempts = 5, then marked unhealthy but supervisor continues

### Dockerfile Minimal Build
- ~51 lines total
- Clones gmweb repo from GitHub during build
- Installs only: git, NVM, Node.js 23.11.1
- Runs `bash install.sh` at build time for system packages
- Copies startup system to `/opt/gmweb-startup` (NOT `/home/kasm-user`)
- BuildKit syntax enabled (`# syntax=docker/dockerfile:1.4`)
- Layer caching optimized for fast rebuilds (subsequent builds 2-3 minutes)

### Dockerfile Clones From GitHub (Critical)
**Important:** Dockerfile clones the repo instead of copying build context:
```dockerfile
RUN git clone https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb && \
    cp -r /tmp/gmweb/startup /opt/gmweb-startup && \
    cp /tmp/gmweb/docker/custom_startup.sh /dockerstartup/custom_startup.sh && \
    rm -rf /tmp/gmweb
```

**Why:** Startup files (install.sh, start.sh, supervisor, 14 services) are only available if cloned from GitHub. Without this, container has no startup system.

**Benefits:**
- Startup files always available regardless of build context
- Works reliably in Coolify and other CI/CD systems
- Gets latest code from GitHub repo
- No dependency on local COPY commands

### Deployment Infrastructure (Coolify)
**Important:** Code is production-ready but deployment requires Coolify domain assignment:
1. Code: All tests pass, all commits pushed, Docker builds cleanly
2. Infrastructure: Requires manual Coolify UI action to assign domain
3. Traefik routing: Auto-generated by Coolify when domain assigned to gmweb service
4. HTTPS: Auto-provisioned by Let's Encrypt (via Coolify)

Without domain assignment in Coolify UI, service returns 502 (no routing rule exists).
