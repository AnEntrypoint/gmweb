# gmweb

A browser-based development desktop you deploy as one container. Open a URL and get a full Linux desktop (XFCE), a web terminal, a file manager, a log viewer and the AgentGUI multi-agent chat, all behind one password.

**Project site:** https://anentrypoint.github.io/gmweb/ (source in [`docs/`](docs/))

## What you get

| Path | What it is |
|---|---|
| `/desk/` | Live XFCE desktop, streamed by Selkies over WebRTC or WebSockets |
| `/ssh/` | Web terminal (webssh2 on ttyd) |
| `/files/` | Web file manager (fsbrowse) |
| `/logs/` | Directory listing of `/config/logs` (plain text, nginx autoindex) |
| `/gm/` | AgentGUI, a chat UI for Claude Code and OpenCode agents |

Every route sits behind HTTP Basic Auth with the `PASSWORD` you set.

## Stack

gmweb is a thin layer on top of existing projects. It does not replace them.

| Layer | Provided by | Role here |
|---|---|---|
| Base image | [LinuxServer webtop](https://github.com/linuxserver/docker-webtop) (`ubuntu-xfce`) | Ubuntu, s6-overlay init, the XFCE session |
| Desktop | [XFCE](https://xfce.org) | Window manager, panel and desktop, started by s6 |
| Streaming | [Selkies](https://github.com/selkies-project/selkies) | Streams the desktop to the browser. WebRTC (UDP `59000`) by default, WebSockets as fallback |
| Reverse proxy | nginx | Ports 80/443, Basic Auth, routes each path to its service |
| Terminal | webssh2 + ttyd | Web shell at `/ssh/` |
| Files | fsbrowse (file-manager service) | Web file browser at `/files/` |
| Agents | AgentGUI | Chat UI at `/gm/` for Claude Code and OpenCode |

Moonlight is not part of this stack. Selkies is the streaming path.

## What gmweb adds

- **Supervisor** (`startup/index.js`) starts and health-checks the web services, with per-service enable flags in `startup/config.json`.
- **Boot script** (`docker/custom_startup.sh`) prepares nginx, the `abc` user, Node.js and npm caches, then runs the supervisor. Installs that can be slow run in the background so they never block startup.
- **Fresh code on every boot.** The container clones this repo from `main` each time it starts, so a push reaches the next restart.
- **Single password.** `PASSWORD` sets the nginx Basic Auth file and the service credentials.
- **Persistent state** in two volumes: `/config` for user data and service state, and `/usr/local` for installed tools.

Architecture notes, design rationale and troubleshooting live in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Running it with Coolify

`docker-compose.yaml` is written for Coolify's Traefik proxy:

- Traefik routes HTTPS to container port 80 (`traefik.http.services.gmweb.loadbalancer.server.port=80`).
- The Traefik transport `gmweb-h1@file` is set in the labels. Your Traefik file provider must define it.
- `59000/udp` is published for WebRTC media. WebSockets carries the same stream over the proxied HTTPS port, so a firewall without UDP forwarding still works.
- `shm_size: 1gb` is needed for the browser inside the desktop.

Environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `PASSWORD` | Basic Auth password for every route | `password` (change it) |
| `PUID` / `PGID` | Owner of `/config` | `1000` |
| `TZ` | Timezone | `Etc/UTC` |
| `FILE_MANAGER_PATH` | Root of the file manager | `/config/Desktop` |
| `SELKIES_WEBRTC_PUBLIC_IP` | Public IP advertised for WebRTC. Blank = autodetected at boot | blank |
| `SELKIES_ENABLE_CLOUDFLARE_TURN`, `SELKIES_CLOUDFLARE_TURN_TOKEN_ID`, `SELKIES_CLOUDFLARE_TURN_API_TOKEN` | Optional TURN relay for networks that block direct UDP | off |
| `GMNEW_RELEASE_BASE` | Override gm release manifest/archive base URL | `https://github.com/AnEntrypoint/gm/releases/download/latest` |
| `GMNEW_SKIP_REGISTER` | `1` skips native `gm install` registration | unset |
| `GMNEW_AUTO_UPDATE` | `0` disables gm's native 15-minute auto-update | auto-update on |
| `GMWEB_GM_MCP_CONFIG` | Optional MCP/playwriter config passed as `--mcp-config` | unset |

The active AgentGUI service loads the latest `main` from GitHub with `npx -y github:AnEntrypoint/agentgui#main`, not from npm. AUTO GM INSTALL uses the native [`AnEntrypoint/gm`](https://github.com/AnEntrypoint/gm) release installer with sha256/size verification; see [`GM_INSTALL.md`](GM_INSTALL.md) for the exact commands, health/retry behavior, and live rollout.

Deploy steps: create a Coolify resource from this repo's `docker-compose.yaml` (or from the published image `almagest/gmweb:latest`), set `PASSWORD`, and deploy. Images for `linux/amd64` and `linux/arm64` are built by `.github/workflows/docker-build-push.yml`.

Headless variant: `docker-compose.headless.yaml` builds `Dockerfile.headless` (Ubuntu 24.04, no desktop, `GMWEB_HEADLESS=1`) for the terminal, files and agent services only.

## Local run

```bash
cp .env.example .env
docker compose up -d --build
```

Set `PASSWORD` in `.env` before starting the containers. Open `https://localhost/` (accept the self-signed certificate) and log in as `abc` with that password.

## Repository layout

```
Dockerfile              webtop-based image (desktop + services)
Dockerfile.headless     Ubuntu-based image (services only)
docker-compose*.yaml    Coolify / Compose deployment
docker/                 boot scripts, nginx config, s6 overlay mods, Selkies config
startup/                supervisor, service modules, config.json
docs/                   project site (GitHub Pages) and notes
.github/workflows/      image build and push
```

## Documentation

- [`docs/index.html`](docs/index.html): the project site, with the stack diagram and deployment map.
- [`docs/version-check.md`](docs/version-check.md): the version-check service (currently disabled).
- [`GM_INSTALL.md`](GM_INSTALL.md): canonical AUTO GM INSTALL and the GitHub-only AgentGUI source rule.
- [`docs/ROLLOUT_REPORT.md`](docs/ROLLOUT_REPORT.md): single deterministic rollout report; generate with `npm run report:rollout`, validate with `npm run validate:rollout-report`, and use bounded `npm run watch:gm-drift` for upstream drift.
- [`docs/POST-RESTART.md`](docs/POST-RESTART.md): bounded read-only live probe, fixtures, and `SELFTEST`/`PASS`/`FAIL`/`UNAVAILABLE` meanings (`npm run probe:post-restart`).
- [`docs/SIMULATED_STARTUP_OUTPUT.txt`](docs/SIMULATED_STARTUP_OUTPUT.txt): bounded offline local startup simulation (`npm run simulate:startup`), with no network, install, registration, or restart.
- [`SETUP.md`](SETUP.md): an older VPS setup walkthrough.
- [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md): operational facts and design decisions.
