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
- `CUSTOM_PORT=6901` - Internal HTTP port (webtop does NOT use 80 - port 80 is for kasmproxy-wrapper only)
- `CUSTOM_HTTPS_PORT=6902` - Internal HTTPS port (automatically CUSTOM_PORT+1)
- `FILE_MANAGER_PATH=/config/Desktop` - Where webtop file uploads/downloads go
- `SUBFOLDER=/desk/` - Optional: run webtop under /desk/ prefix instead of root (requires kasmproxy-wrapper support)
- `PASSWORD` or `VNC_PW` - HTTP Basic auth password
- `CUSTOM_USER` - HTTP Basic auth username (default: abc)

**Important**: LinuxServer webtop does NOT listen on port 80. Only ports 3000 (HTTP) and 3001 (HTTPS) are used internally. We override this with CUSTOM_PORT.

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

**Exposed to host (docker-compose port mappings):**
- 6901 → 6901: Webtop HTTP (CUSTOM_PORT, for direct desktop access)
- 6902 → 6902: Webtop HTTPS (CUSTOM_HTTPS_PORT, for direct desktop access)

**IMPORTANT: Port 80 stays INTERNAL to container - DO NOT expose it in docker-compose**
Port 80 is where kasmproxy-wrapper listens. Exposing it causes "Bind for 0.0.0.0:80 failed" errors in environments where port 80 is already in use (Coolify, Traefik, etc). The internal routing still works without external exposure.

**Internal service ports (container only, never expose externally):**
- 80: kasmproxy-wrapper (reverse proxy, routing, auth bypass, SUBFOLDER prefix stripping)
  - Handles `/ui`, `/api`, `/ws` → 9997 (Claude Code UI)
  - Handles `/files` → 9998 (file-manager, public)
  - Handles `/ssh`, `/ssh/ws` → 9999 (webssh2/ttyd)
  - Handles `/websockify` → 6901 (Webtop VNC, public)
  - Handles `/` → 6901 (Webtop web UI) or kasmproxy on 8080
- 8080: kasmproxy (authentication middleware from AnEntrypoint/kasmproxy)
- 6901: Webtop HTTP (set via CUSTOM_PORT environment variable)
- 6902: Webtop HTTPS (set via CUSTOM_HTTPS_PORT environment variable)
- 9997: Claude Code UI
- 9998: file-manager (standalone server)
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

## Discovered Gotchas & Migration Fixes

### Port Mapping Removal (Coolify Optimization)

**Discovery:** Explicit port mappings and EXPOSE statements are unnecessary in Coolify-based deployments.

**Rationale:**
- Coolify manages all port exposure through domain assignment in the UI
- When you assign a domain to a service in Coolify, Traefik automatically creates routing rules
- EXPOSE statements in Dockerfile are informational only and don't affect Coolify
- Docker-compose port mappings (`"6901:6901"`) are not used in Coolify environments

**Changes Made:**
- Removed `ports:` section from docker-compose.yaml
- Removed `EXPOSE 6901 6902 80` from Dockerfile
- Internal port configuration remains (CUSTOM_PORT=6901, etc.)
- Webtop still listens on port 6901 internally; Coolify handles external routing

**Effect:**
- Cleaner, simpler configuration
- No conflicts with host port availability
- Coolify assigns domain → Traefik creates routing → Service accessible via domain
- To access: Assign domain in Coolify UI (e.g., `desk.acc.l-inc.co.za`), then use that domain

**Deployment Note:**
After removing ports from docker-compose, domain assignment in Coolify is REQUIRED for external access. Without domain assignment, Coolify returns 502 Bad Gateway.

### KasmWeb → LinuxServer Webtop Migration Issues

**Issue 1: Old KasmWeb paths in startup system**
- **Problem**: Code referenced `/home/kasm-user/logs` which doesn't exist in webtop
- **Impact**: Supervisor failed to create log directories, startup system crashed
- **Fix**: Updated `startup/start.sh` to use `$HOME` env var (defaults to `/config`), updated `startup/config.json` logDirectory to `/config/logs`
- **Files affected**: `startup/start.sh`, `startup/config.json`, `startup/lib/supervisor.js`

**Issue 2: Port 80 binding conflict**
- **Problem**: docker-compose exposed port 80 to host (`"80:80"`), but port 80 already allocated in deployment environments
- **Error**: `Bind for 0.0.0.0:80 failed: port is already allocated`
- **Impact**: Container failed to start on Coolify, any system where Traefik/reverse proxy uses port 80
- **Fix**: Removed `"80:80"` port mapping from docker-compose.yaml
- **Critical**: Port 80 stays INTERNAL to container for kasmproxy-wrapper. Do NOT expose it externally
- **Files affected**: `docker-compose.yaml`

**Issue 3: Incorrect webtop port configuration**
- **Problem**: Initially tried `PORT=6901` instead of `CUSTOM_PORT=6901`
- **Solution**: Use `CUSTOM_PORT` and `CUSTOM_HTTPS_PORT` environment variables (correct variable names for LinuxServer webtop)
- **Files affected**: `docker-compose.yaml`, `startup/kasmproxy-wrapper.js`

### Port Architecture (Finalized)

**Why only expose 6901/6902 to host?**
- Webtop web UI runs on CUSTOM_PORT (6901)
- Port 80 runs kasmproxy-wrapper (internal reverse proxy) - DO NOT expose to host
- All other services (9997, 9998, 9999, 8080) are internal only
- External access goes through: Host:6901 → Container:6901 (webtop) or Host doesn't access port 80

**SUBFOLDER Support Added**
- Added `SUBFOLDER=/desk/` environment variable to docker-compose
- kasmproxy-wrapper now strips prefix: `/desk/ui` → `/ui` before routing
- Enables running entire webtop under a path prefix if needed

### LinuxServer Webtop Specifics

**Differences from KasmWeb:**
| Aspect | KasmWeb | LinuxServer Webtop |
|--------|---------|-------------------|
| Home dir | `/home/kasm-user` | `/config` |
| Default user | `kasm-user` | `abc` |
| Port control | Built-in 3000/3001 | `CUSTOM_PORT` env var (defaults 3000/3001) |
| Init system | Direct Dockerfile | s6-overlay + custom-cont-init.d |
| Desktop type | KasmVNC | Selkies (nginx + streaming) |

**Important**: LinuxServer webtop does NOT listen on port 80 by default. We use CUSTOM_PORT=6901 to avoid conflicts.

## Coolify & Docker Hub Integration

### Automatic Docker Hub Push After Build

To automatically push images to Docker Hub after Coolify builds:

**Prerequisites:**
- Docker CLI logged in: `docker login` (creates `~/.docker/config.json`)
- Coolify has access to these credentials
- Docker Hub account with repository created (e.g., `almagest/gmweb`)

**Setup via coolify-cli:**
1. List applications: `coolify app list` (get UUID)
2. Configure Docker Hub push:
   ```bash
   coolify app update <uuid> \
     --docker-image almagest/gmweb \
     --docker-tag latest
   ```
3. Deploy (builds and pushes):
   ```bash
   coolify app start <uuid>
   ```

**Result:**
After each deployment, Docker Hub will have:
- `almagest/gmweb:latest` (latest stable)
- `almagest/gmweb:<git-commit-sha>` (version tracking)

**Verification:**
```bash
docker pull almagest/gmweb:latest
```

### Alternative: UI-Based Setup

1. Open gmweb application in Coolify UI
2. Go to **Settings → General**
3. Set **Docker Image** field: `almagest/gmweb`
4. Set **Docker Image Tag** field: `latest`
5. Save and deploy

## Multi-Architecture Builds (amd64 & arm64)

### Why Multi-Arch?

The LinuxServer webtop base image (`lscr.io/linuxserver/webtop:ubuntu-xfce`) is already published for multiple architectures. We automatically build for both to support deployment on x86_64 and ARM64 servers.

### Build Configuration

**x-bake section in docker-compose.yaml** (already configured):
```yaml
x-bake:
  targets:
    gmweb:
      platforms:
        - linux/amd64
        - linux/arm64
```

This tells buildx to create multi-arch images automatically.

### Building Locally

**Prerequisites:**
- Docker Desktop (includes buildx), OR
- Linux: `docker buildx create --use` to enable buildx

**Build and push to Docker Hub (creates manifest list):**
```bash
docker buildx bake --push
```

This will:
1. Build for both amd64 and arm64
2. Push both variants to Docker Hub
3. Create and push a manifest list (so Docker auto-selects correct variant)

**Result on Docker Hub:**
- `almagest/gmweb:latest` → manifest list pointing to both architectures
- `almagest/gmweb:amd64` → x86_64 specific image
- `almagest/gmweb:arm64` → ARM64 specific image
- `almagest/gmweb:<commit-sha>` → multi-arch for current commit

### Building via Coolify

Coolify doesn't natively support buildx bake yet. Workaround:
1. Build locally with buildx bake and push to Docker Hub
2. Configure Coolify to pull from `almagest/gmweb:latest`
3. Coolify will automatically use the correct architecture variant

**Future:** When Coolify supports buildx, multi-arch builds will happen automatically on deployment.

### Performance Note

- **Native builds** (matching server CPU): Fast
- **QEMU emulation** (cross-arch on one server): ~4-5x slower

For production multi-arch builds, use multiple native builder nodes (one amd64, one arm64) via:
```bash
docker buildx create --name multiarch
docker buildx create --append --name multiarch
docker buildx use multiarch
```

## Coolify Deployment (Complete Setup)

### How Coolify Builds This Project

Coolify discovers and builds `docker-compose.yaml` applications via:
1. Clones your Git repo
2. Reads docker-compose.yaml
3. Executes `docker-compose build` (respects build variables)
4. Runs `docker-compose up -d` with your configured domain

**Important:** Coolify does NOT use `docker buildx` by default. Multi-arch support is via the x-bake section for local development.

### Pre-Deployment Checklist

**1. Create .env file from example:**
```bash
cp .env.example .env
# Edit .env and set VNC_PW to a strong password
```

**2. Set environment variables in Coolify UI:**
- Application → Settings → Environment
- Required:
  - `VNC_PW`: Password for desktop access
  - `CUSTOM_PORT=6901` (already in docker-compose)
  - `CUSTOM_HTTPS_PORT=6902` (already in docker-compose)
  - `FILE_MANAGER_PATH=/config/Desktop` (already in docker-compose)
  - `SUBFOLDER=/desk/` (already in docker-compose)

**3. Configure Docker Hub push:**
- Application → Settings → General
- Docker Image: `almagest/gmweb`
- Docker Image Tag: `latest`
- Requires: `docker login` on Coolify server

**4. Verify build won't fail:**
```bash
# Test locally first
docker-compose build
docker-compose up -d
# Check it starts without errors
docker-compose logs -f
```

### Deployment via Coolify CLI

**1. List and get application UUID:**
```bash
coolify app list
```

**2. Set environment variables:**
```bash
coolify app env create <uuid> VNC_PW "strong-password"
```

**3. Configure Docker Hub:**
```bash
coolify app update <uuid> \
  --docker-image almagest/gmweb \
  --docker-tag latest
```

**4. Deploy (builds and pushes):**
```bash
coolify app start <uuid>
```

**5. Monitor build:**
```bash
# Watch deployment logs in real-time
coolify app deployments logs <uuid> -f
```

### Verifying Build Success

After deployment completes:

**Check container is running:**
```bash
docker ps | grep gmweb
```

**Verify ports are listening:**
```bash
# On Coolify server:
lsof -i :6901   # Webtop HTTP
lsof -i :6902   # Webtop HTTPS
lsof -i :80     # kasmproxy-wrapper (internal)
```

**Test Docker Hub image:**
```bash
docker pull almagest/gmweb:latest
docker image inspect almagest/gmweb:latest | grep -E "Architecture|RepoTags"
```

### Common Coolify Build Issues

**Issue: "Cannot connect to Docker daemon"**
- Coolify server requires Docker to be running
- SSH to server and verify: `docker ps`

**Issue: "Port 80 already in use"**
- This was fixed by NOT exposing port 80 to host
- Port 80 is internal only (kasmproxy-wrapper)
- If error persists, verify docker-compose.yaml has no `"80:80"` mapping

**Issue: "Build context too large"**
- Coolify has a .dockerignore file
- Ensure large files/directories are excluded

**Issue: Docker Hub push fails**
- Verify `docker login` was run on Coolify server
- Credentials stored in `~/.docker/config.json`
- Run again: `docker login` with credentials

### Troubleshooting: Enable Debug Logs

Coolify CLI debug mode:
```bash
coolify --debug app start <uuid>
```

Check Coolify server logs:
```bash
docker logs -f $(docker ps | grep coolify | head -1 | awk '{print $1}')
```

### Docker Hub Credentials Setup (Critical for Auto-Push)

**On Coolify Server - SSH and authenticate with Docker Hub:**

```bash
# Login to Docker Hub
docker login

# When prompted, enter:
# Username: almagest
# Password: (use Personal Access Token, NOT password)
# Login Succeeded ✓

# Verify credentials are saved
cat ~/.docker/config.json
# Should show: "auths": { "https://index.docker.io/v1/": { "auth": "..." } }
```

**Important:** Use a **Personal Access Token** (not your Docker Hub password):
1. Go to Docker Hub → Account Settings → Security
2. Create new Personal Access Token
3. Copy the token and use it as password for `docker login`
4. Token is stored securely in `~/.docker/config.json`

**In Coolify UI - Set Docker Hub credentials:**
1. Application → Settings → General
2. Docker Image: `almagest/gmweb`
3. Docker Image Tag: `latest`
4. (Optional) Docker Registry: `docker.io` (default for Docker Hub)
5. Save

**Verify Coolify has credentials:**
```bash
# SSH to Coolify server
docker login --check
# Or list what's stored:
docker info | grep -A5 "Registries:"
```

**Test push capability:**
```bash
# SSH to Coolify server
docker pull hello-world
docker tag hello-world:latest almagest/test:latest
docker push almagest/test:latest
# Should succeed without auth errors
```

If push succeeds, Coolify can push to Docker Hub after builds.

**On Next Deployment:**
1. Push code: `git push origin main`
2. Trigger Coolify deploy: `coolify app start <uuid>`
3. Coolify will build and automatically push `almagest/gmweb:latest` + commit SHA
4. Verify on Docker Hub: https://hub.docker.com/r/almagest/gmweb

## GitHub Actions CI/CD for Multi-Arch Docker Builds

### Automated Build & Push to Docker Hub

Created `.github/workflows/docker-build-push.yml` to automate multi-architecture image builds and Docker Hub pushes.

**How it works:**
1. Every commit to `main` branch triggers the workflow
2. GitHub Actions builds for `linux/amd64` and `linux/arm64` simultaneously
3. Upon success, pushes to Docker Hub as:
   - `almagest/gmweb:latest` (stable tag)
   - `almagest/gmweb:<commit-sha>` (versioned tag)

**Required Setup:**

Add GitHub secrets (run via CLI):
```bash
gh secret set DOCKER_HUB_USERNAME --body "almagest"
gh secret set DOCKER_HUB_TOKEN --body "<personal-access-token>"
```

**Important:** Use Docker Hub **Personal Access Token**, not password:
- Docker Hub → Account Settings → Security → Create New Access Token
- Copy token, paste into `gh secret set DOCKER_HUB_TOKEN`

**Multi-arch build time:**
- First build: ~15-20 minutes (both platforms)
- Cached builds: ~5-10 minutes (BuildKit layer caching)

**Verification:**
After workflow completes, verify on Docker Hub:
```bash
docker pull almagest/gmweb:latest
docker image inspect almagest/gmweb:latest | grep Architecture
# Shows: "linux/amd64", "linux/arm64"
```

**Coolify Integration:**
- After GitHub Actions pushes image, Coolify can pull `almagest/gmweb:latest`
- No manual intervention needed - Coolify automatically uses the pre-built image
- Deployment becomes: Pull built image → Run container (minutes instead of build+run hours)

## Coolify & Traefik Service Routing

### Critical: EXPOSE vs Port Mapping

**DO NOT** use explicit port mappings in docker-compose.yaml when deploying to Coolify:
```yaml
# WRONG - will conflict with Traefik and other services:
ports:
  - "8080:80"
  - "8443:443"
```

**Instead:**
1. Add EXPOSE statements to Dockerfile for port discovery
2. Add Traefik labels to docker-compose.yaml for routing configuration
3. Let Traefik/Coolify handle all reverse proxy routing

**Why:** Coolify is a multi-application platform where Traefik already manages port 80 and 443. Explicit host port mappings cause "port already allocated" errors when multiple services compete.

### Traefik Label Configuration

Minimal required labels for Coolify service discovery:
```yaml
labels:
  - traefik.enable=true
  - traefik.http.services.gmweb.loadbalancer.server.port=80
```

- `traefik.enable=true` - Enables Traefik service discovery
- `traefik.http.services.gmweb.loadbalancer.server.port=80` - Routes traffic to internal port 80 (where kasmproxy-wrapper listens)

### Health Checks in Coolify

**Avoid curl-based health checks** in docker-compose when deploying to Coolify:
```yaml
# Problematic - may cause container to exit prematurely:
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost/"]
```

**Why:** Health check failures during startup (before services fully initialize) can cause Coolify to mark the container unhealthy and exit it. For this project, services take ~60 seconds to fully start, and curl may timeout during that window.

**Solution:** Omit health checks in Coolify deployments, or use very lenient timing (high retry count, long timeout).

### EXPOSE Statements

Always include EXPOSE in Dockerfile for port discovery:
```dockerfile
EXPOSE 80 3000 6901
```

- Port 80: kasmproxy-wrapper (main entry point)
- Port 3000: LinuxServer webtop web UI (fallback)
- Port 6901: VNC websocket (backup)

Traefik uses EXPOSE to discover available ports even without port mappings.

### Coolify Port Conflict Resolution

If you see: `Bind for 0.0.0.0:8080 failed: port is already allocated`
- Remove explicit `ports:` section from docker-compose.yaml
- Ensure Traefik labels are present
- Restart deployment via Coolify UI
- Traefik will automatically route to the exposed ports internally
