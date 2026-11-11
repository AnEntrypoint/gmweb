# AUTO GM INSTALL and AgentGUI source

gmweb follows the current [`AnEntrypoint/gm`](https://github.com/AnEntrypoint/gm) install contract. No Node-based `add-mcp` registration is used.

## gm: canonical installer

The canonical one-shot POSIX command is:

```sh
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh | sh
```

To pass a playwriter/MCP config path:

```sh
curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh | sh -s -- --mcp-config <path>
```

gmweb's supervisor service `startup/services/gm-install.js` starts this install (or the exact vendored copy at `docker/install-gm.sh`) detached, after supervisor startup has already proceeded. It logs to `/config/logs/gm-install.log`, reports health on `~/.gmnew/current/gm` plus `.gmnew-update.json`, and retries via the normal supervisor health loop when an install fails. A slow GitHub download therefore never blocks nginx, the supervisor, or any other service.

The installer:

1. Reads `https://github.com/AnEntrypoint/gm/releases/download/latest/manifest.json` (overrideable with `GMNEW_RELEASE_BASE`).
2. Selects the `gmnew-<target>` archive for Linux/macOS x64/arm64, downloads it with retries, and verifies both manifest `sha256` and `size`.
3. Atomically replaces `$HOME/.gmnew/current` and writes `.gmnew-update.json` when missing.
4. Runs `$HOME/.gmnew/current/gm install [--mcp-config <path>]`, which sets `mcpServers.gm` to the native binary. `GMNEW_SKIP_REGISTER=1` skips this registration.
5. Leaves gm's native auto-update in charge: it checks `latest` at start and every 15 minutes. Set `GMNEW_AUTO_UPDATE=0` to disable auto-update.

Environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `GMNEW_RELEASE_BASE` | Release manifest/archive base URL | `https://github.com/AnEntrypoint/gm/releases/download/latest` |
| `GMNEW_SKIP_REGISTER` | Set to `1` to skip `gm install` registration | unset |
| `GMNEW_AUTO_UPDATE` | Set to `0` to disable the installed server's 15-minute update checks | auto-update on |
| `GMWEB_GM_MCP_CONFIG` | Optional config path passed as `--mcp-config` by the gmweb service | unset |
| `GMWEB_GM_INSTALL_RETRY_SECONDS` | Minimum delay before a failed install is retried by health checks | `300` |

## AgentGUI: latest from GitHub, not npm

The active startup service launches AgentGUI with:

```sh
npx -y github:AnEntrypoint/agentgui#main
```

This resolves the `main` branch of `AnEntrypoint/agentgui` directly from GitHub. There is no npm version pin. Owner rule: **any `npx` invocation for AgentGUI must use `github:` syntax**; never `agentgui`, `agentgui@latest`, or `agentgui@<version>`.

`startup/services/agentgui.js` keeps its executable candidate resolution, port cleanup, process-group termination, stream logging, and 3-minute restart grace. `startup/start.sh` still verifies Bun because other services may use it; AgentGUI itself no longer requires `bunx`.

## Live rollout

`docker/rest-of-startup.sh` fetches `STARTUP_REF` (default `main`) into `/opt/gmweb-startup/` on every container boot. The next container restart fetches these service files; a supervisor reload on an already-running container may use already-cached modules, so restart the container (or replace `/opt/gmweb-startup/` and restart the supervisor) to guarantee the new source. No commit, push, image publish, or service start is required for this repository edit to be reviewable.

## Verification

```sh
npm run check
npm --prefix startup run check
node startup/check-runtime-install.mjs
```

`npm run check` and `npm --prefix startup run check` run the static source gate followed by `startup/check-runtime-install.mjs`. The static gate parses active startup sources and the installer, asserts the GitHub/npm rules and canonical installer behavior, checks for credential-like strings, and invokes `node --check`, `bash -n`, and `sh -n`.

## Runtime smoke proof

`startup/check-runtime-install.mjs` is bounded, offline, and deterministic:

- It imports the real `startup/services/agentgui.js`, intercepts the single spawn through `__setAgentGuiSpawnForTest`, calls `start()` with `GMWEB_AGENTGUI_SMOKE_TEST=1`, and asserts the constructed command is `npx -y github:AnEntrypoint/agentgui#main`. No `npx`, `bunx`, npm install, git config change, or `gh` credential setup runs in smoke mode.
- It asserts no forbidden active spec (`agentgui@1.0.1126`, `agentgui@latest`, `bunx ... agentgui@`, or a bare npm spec) appears in the runtime command, then calls the real cleanup path and verifies the test port is free.
- It exercises `GM_INSTALL_DRY_RUN=1` on the real `gm-install` service and `resolveInstallerCommand()`, proving the canonical URL, `--mcp-config`, `GMNEW_SKIP_REGISTER`, `GMNEW_AUTO_UPDATE`, detached/non-blocking semantics, log path, sha256/size/manifest behavior, and installer parity without spawning an installer.
- It verifies no long-lived service or installer command survives with a bounded `ps` scan; the harness excludes only its own PID.

It deliberately does **not** perform a real install into `~/.gmnew/current`, overwrite MCP registration, open port 9897, restart a container, contact the network, or publish/commit/push. There is no live release-manifest probe.

## Production rollout

After this repository change is accepted, restart the container:

```sh
docker compose restart gmweb
```

At boot, `docker/rest-of-startup.sh` fetches `STARTUP_REF` (default `main`) into `/opt/gmweb-startup/`, including `startup/services/agentgui.js`, `startup/services/gm-install.js`, and `docker/install-gm.sh`. That fresh fetch is what makes the live supervisor use the GitHub AgentGUI spec and the canonical AUTO GM INSTALL path. A supervisor-only reload can keep cached modules and is not the recommended production step. Immediate post-restart checks, `UNAVAILABLE` live-probe semantics, and upstream-drift handling are in [`docs/POST-RESTART.md`](docs/POST-RESTART.md).

## Installer parity rule

`docker/install-gm.sh` is an exact copy of `/workspace/gm/scripts/install.sh`; the checks compare an explicit behavioral signature of all non-comment executable lines after dropping only the environment-overridable `RELEASE_BASE=` assignment. The signature covers OS/arch mapping, `--local`, `register()`, `swap_in`, `VERSIONS_DIR`, `current.next`, manifest URL, retry flags, target naming, sha256/size checks, `.gmnew-update.json`, `gm install --mcp-config`, and `GMNEW_SKIP_REGISTER`. `GM_SOURCE` can override the canonical source path used by the static checker. No executable statement may differ; comment-only provenance lines are ignored by the signature.

## Single deterministic rollout report

Generate and validate one offline report before a production restart:

```sh
npm run report:rollout
npm run validate:rollout-report
```

Outputs: `docs/ROLLOUT_REPORT.json` and `docs/ROLLOUT_REPORT.md`. The report records gmweb/gm git state, installer sha256 parity, active AgentGUI spec, every gate count and exit code, offline/live post-restart status, exact rollout commands, rollback, and `ok: true` only when all reported gates pass. Apart from `generatedAt`, its content is deterministic from the current files and gate outputs.

Bounded upstream watcher (10 minutes / 15s by default; `--once` for one deterministic check):

```sh
npm run watch:gm-drift
node startup/check-gm-upstream-drift.mjs --watch --once
node startup/watch-gm-drift.mjs --once
```

It runs the drift gate, regenerates the rollout report if `/workspace/gm/scripts/install.sh` changes, and prints the exact manual `cp /workspace/gm/scripts/install.sh docker/install-gm.sh` action on drift. It never copies/modifies gm or gmweb automatically.

## Bounded live post-restart probe

Run the deterministic fixture self-test (no URL/log supplied, no network):

```sh
npm run probe:post-restart
node startup/live-post-restart-probe.mjs
```

Against a reachable deployment, explicitly supply a URL and optional log:

```sh
npm run probe:post-restart -- --url https://gmweb.example --log /config/logs/gm-install.log
```

`--url` is the only opt-in to bounded GET/HEAD HTTP probes; each probe timeout is capped at 2s via `GMWEB_PROBE_TIMEOUT_MS`. The tool reads supplied/local logs only, scans them for tokens and signed URLs, checks the active `github:` spec, rejects stale npm specs, and checks gm manifest/sha256/version and `~/.gmnew/current` semantics. It never writes, restarts production, installs, registers MCP, or publishes.

Status meanings:

- `SELFTEST`: no URL/log supplied; healthy/stale/unreachable fixtures were exercised.
- `PASS`: reachable deployment and log evidence satisfied all checks.
- `FAIL`: reachable but evidence contradicted the rollout (for example a stale npm pin).
- `UNAVAILABLE`: explicit endpoint was unreachable; no live verification was possible.

Fixture cases are under `startup/fixtures/post-restart/`: `healthy` expected `PASS`, `stale-npm-pin` expected `FAIL`, `unreachable` expected `UNAVAILABLE`. `npm run check:live-probe-fixtures` asserts all three deterministically and is included in both check suites.

## Bounded local startup simulation

Prove the changed startup sequence without a container build, restart, network fetch, real gm install, or MCP registration:

```sh
npm run simulate:startup
node startup/check-simulated-startup.mjs
```

`startup/simulate-container-startup.mjs` creates an OS temp workspace, copies the exact `startup/` and `docker/install-gm.sh` files into fetched/runtime trees, puts argv-only mock `curl`, `git`, `npx`, `bunx`, and `sh` binaries first on `PATH`, and imports the real `agentgui.js` and `gm-install.js` modules. It sets `GMNEW_SKIP_REGISTER=1`, `GMWEB_PROBE_TIMEOUT_MS=1200`, `GMWEB_AGENTGUI_SMOKE_TEST=1`, and `GM_INSTALL_DRY_RUN=1`. Dependency sorting puts `gm-install` and `agentgui` in the first parallel group; supervisor readiness is emitted before detached installer resolution.

Output artifact: `docs/SIMULATED_STARTUP_OUTPUT.txt` contains the exact command, exit code, status, and bounded output. This is a simulation: unlike the offline post-restart plan it exercises real modules in a temp tree; unlike the explicit `npm run probe:post-restart -- --url ... --log ...` live probe it never contacts a deployment. It never restarts production.

## Single release-readiness decision

Generate the one-command bounded decision artifact:

```sh
npm run check:release-readiness
npm run validate:release-readiness
npm run check:release-readiness -- --watch --once
```

Outputs: `docs/RELEASE_READINESS.json` and `docs/RELEASE_READINESS.md`. `ok: true` means every deterministic command passed (or `UNAVAILABLE` for the opt-in live post-restart probe), installer parity held, no active forbidden AgentGUI spec existed, hidden-token scan was clean, and no survivor process remained. `rolloutAction: READY: ...` is the decision to restart only after the change is accepted on `STARTUP_REF=main`. The watcher is bounded to 10 minutes / 20s (or `--once`) and reports changes without copying/modifying/restarting/installing/publishing.

