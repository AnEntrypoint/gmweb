# gmweb container rollout

This document records the exact Docker/startup path validated by `startup/check-container-startup-path.mjs`. It is static plus a bounded temp-directory copy simulation; it does not build or restart a container. Post-restart commands and offline/live probe semantics are in [`docs/POST-RESTART.md`](POST-RESTART.md).

## Baked into the image

`docker-compose.yaml` builds `Dockerfile`; `docker-compose.headless.yaml` builds `Dockerfile.headless`. Both Dockerfiles `COPY` these helper files into `/custom-cont-init.d/`:

| Repository file | Image path |
|---|---|
| `docker/99-gmweb-startup.sh` | `/custom-cont-init.d/99-gmweb-startup.sh` (only executable init helper) |
| `docker/custom_startup.sh` | `/custom-cont-init.d/custom_startup.sh` |
| `docker/nginx-setup.sh` | `/custom-cont-init.d/nginx-setup.sh` |
| `docker/nginx-sites-enabled-default` | `/custom-cont-init.d/nginx-sites-enabled-default` |
| `docker/rest-of-startup.sh` | `/custom-cont-init.d/rest-of-startup.sh` |
| `docker/background-installs.sh` | `/custom-cont-init.d/background-installs.sh` |
| `docker/install-gm.sh` | `/custom-cont-init.d/install-gm.sh` (fallback copy; the active service uses the fetched copy below) |

`docker/99-gmweb-startup.sh` executes the baked `custom_startup.sh`, which prepares nginx and spawns `rest-of-startup.sh` with `nohup`. Compose files only select the Dockerfile and environment/volumes; neither pins `STARTUP_REF`.

## Fetched at every container boot

`docker/rest-of-startup.sh` sets `STARTUP_SOURCE_URL="https://github.com/AnEntrypoint/gmweb.git"` and `STARTUP_REF="${STARTUP_REF:-main}"`, clears stale `/opt/gmweb-startup/` service files, then `git fetch --depth 1 --filter=blob:none origin "$STARTUP_REF"` and checks out `FETCH_HEAD`.

It copies:

| Repository source in fetched tree | Runtime destination |
|---|---|
| `startup/*` | `/opt/gmweb-startup/*` |
| `startup/services/agentgui.js` | `/opt/gmweb-startup/services/agentgui.js` |
| `startup/services/gm-install.js` | `/opt/gmweb-startup/services/gm-install.js` |
| `startup/check-startup-sources.mjs`, `startup/check-runtime-install.mjs`, `startup/check-container-startup-path.mjs` | `/opt/gmweb-startup/check-*.mjs` |
| `docker/install-gm.sh` | `/opt/gmweb-startup/install-gm.sh` |

`startup/start.sh` launches `/opt/gmweb-startup/index.js`. `startup/index.js` loads `services/agentgui.js` and `services/gm-install.js`; `startup/config.json` enables both. `gm-install.js` resolves `../install-gm.sh`, i.e. the freshly fetched `/opt/gmweb-startup/install-gm.sh`, not the baked `/custom-cont-init.d/install-gm.sh`.

## Why restart is required

A live supervisor has already imported its service modules from `/opt/gmweb-startup/` and cannot see a repository change. A **container restart** reruns `rest-of-startup.sh`, which deletes the stale runtime service files, fetches `AnEntrypoint/gmweb` at `main`, copies this tree into `/opt/gmweb-startup/`, and starts a fresh supervisor. A supervisor-only reload can retain cached modules, so it is not the production rollout step.

Production rollout command after the change is accepted on `main`:

```sh
docker compose restart gmweb
```

For the headless Compose service, use:

```sh
docker compose -f docker-compose.headless.yaml restart gmweb-headless
```

Neither command publishes an image or commits repository changes. If deployment builds from source, build first; do not `git push`, `docker push`, or `npm publish` as part of this validation.

## Verify after restart

Inside the restarted container or against the fetched runtime tree:

```sh
grep -n "github:AnEntrypoint/agentgui#main" /opt/gmweb-startup/services/agentgui.js
grep -n "spawnAgentGui(npxBin, \['-y', AGENTGUI_PACKAGE\]" /opt/gmweb-startup/services/agentgui.js
grep -n "STARTUP_REF" /config/logs/rest-of-startup.log
grep -n "AUTO GM INSTALL source=" /config/logs/supervisor.log /config/logs/gm-install.log
sha256sum /opt/gmweb-startup/install-gm.sh
```

From the repository workspace, compare the canonical installer:

```sh
sha256sum docker/install-gm.sh /workspace/gm/scripts/install.sh
```

The two hashes must match. A live `npx` AgentGUI command should name `github:AnEntrypoint/agentgui#main`; `/config/logs/gm-install.log` should show the canonical source and non-blocking/dry-run-safe health behavior. No token or signed URL is required.

## Rollback

Revert the changed repository files on `main` (or the deployment's `STARTUP_REF`), then repeat the same container restart. The next boot re-fetches that revision and replaces `/opt/gmweb-startup/` with its `startup/` tree and `docker/install-gm.sh`. No persistent gm install or MCP state is overwritten by the deterministic checks; rollback of a real installed build is owned by gm's own versioned `~/.gmnew/versions` layout.

## Validation gates

```sh
node startup/check-container-startup-path.mjs
node scripts/check-rollout-docs.mjs
npm run check
npm --prefix startup run check
```

These are offline, fast, and leave no long-lived service. `npm run check` includes the static source gate, runtime smoke, container-path simulation, and this rollout-documentation gate.

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

