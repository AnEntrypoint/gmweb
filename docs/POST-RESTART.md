# Post-restart verification plan

This plan is validated offline by `startup/check-post-restart.mjs`. The checker never start/restart containers, never publishes, and never performs a real install or MCP registration overwrite. It does not restart production. `--live` is an opt-in, bounded, read-only probe; if no local gmweb service is reachable it prints `UNAVAILABLE` and exits successfully.

## Production rollout

After the change is accepted on the deployment's `STARTUP_REF` (default `main`), restart the container:

```sh
docker compose restart gmweb
```

Headless variant:

```sh
docker compose -f docker-compose.headless.yaml restart gmweb-headless
```

Why restart: `docker/rest-of-startup.sh` uses `STARTUP_REF="${STARTUP_REF:-main}"`, fetches `https://github.com/AnEntrypoint/gmweb.git`, clears stale service files under `/opt/gmweb-startup/`, copies the fetched `startup/` tree plus `docker/install-gm.sh`, and then starts a fresh supervisor. A `STARTUP_REF=main` log line plus a fresh fetch means the running supervisor loaded the current repository revision; a supervisor-only reload can reuse cached modules and is not sufficient evidence.

## Immediate post-restart checks

Inside the restarted container or against its runtime volume:

```sh
grep -n "github:AnEntrypoint/agentgui#main" /opt/gmweb-startup/services/agentgui.js
grep -n "spawnAgentGui(npxBin, \['-y', AGENTGUI_PACKAGE\]" /opt/gmweb-startup/services/agentgui.js
grep -RInE 'agentgui@1\.0\.1126|agentgui@latest|bunx.*agentgui@|npx -y agentgui' /opt/gmweb-startup/services/agentgui.js
# The active deny list also covers a bare npm spec in CI checks.
# Expected: no agentgui@1.0.1126, no agentgui@latest, no bunx ... agentgui@, no bare npm spec.
grep -n "STARTUP_REF" /config/logs/rest-of-startup.log
grep -n "AUTO GM INSTALL source=" /config/logs/supervisor.log /config/logs/gm-install.log
grep -nE 'manifest.json|sha256|size|gmnew|version' /config/logs/gm-install.log
sha256sum /opt/gmweb-startup/install-gm.sh
```

Expected:

- The first grep finds `github:AnEntrypoint/agentgui#main`; the second finds the `npx -y` spawn.
- The forbidden grep returns no matches (exit `1`).
- `STARTUP_REF` is `main` unless the deployment deliberately overrides it.
- gm installer logs show the canonical source and manifest/sha256/size/version evidence.
- `/config/logs/supervisor.log` shows the supervisor and service health monitoring, not a blocking installer wait.

From the repository workspace, compare the canonical gm installer:

```sh
sha256sum docker/install-gm.sh /workspace/gm/scripts/install.sh
```

The hashes must match. If `scripts/check-gm-upstream-drift.mjs` reports drift, update with:

```sh
cp /workspace/gm/scripts/install.sh docker/install-gm.sh
```

then rerun both check suites and the container-path/runtime gates.

For an HTTP-level health probe when the service is reachable:

```sh
curl -fsS --max-time 2 http://127.0.0.1/gm/api/agents
```

`GMWEB_POST_RESTART_URL`, `GMWEB_POST_RESTART_PORT`, and `GMWEB_POST_RESTART_TIMEOUT_MS` configure `--live`; the timeout is capped at 3000 ms.

## Offline vs live

Offline is the default:

```sh
npm run check:post-restart
node startup/check-post-restart.mjs --offline
```

It validates this document's command strings, real repository paths, `/workspace/gm/scripts/install.sh`, log paths, sha parity command, bounded timeout, secret/publish exclusions, and the links to this plan. It contacts no service and makes no filesystem changes outside reading.

Live is opt-in:

```sh
node startup/check-post-restart.mjs --live
```

It performs only bounded read-only `curl -fsS` GET probes against the configured local URL/port and reads local logs/runtime tree when available. If no local service responds it prints `LIVE_EVIDENCE`, `UNAVAILABLE`, and exits `0`. `UNAVAILABLE` means "not verified live"; it does not mean the offline plan failed. Live mode does not start or restart containers and does not require credentials.

Upstream drift is checked separately:

```sh
npm run check:gm-drift
node scripts/check-gm-upstream-drift.mjs
```

It records `/workspace/gm` HEAD, byte hashes, and behavioral signatures. On drift it reports the first differing section/line and the exact copy-and-recheck action, then exits non-zero. It never modifies `/workspace/gm`.

## Rollback

Revert the changed repository files on `main` (or the deployment's `STARTUP_REF`), then repeat the same container restart. The boot fetch replaces `/opt/gmweb-startup/` from that revision. No deterministic checker overwrites gm install state or MCP registration.

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

