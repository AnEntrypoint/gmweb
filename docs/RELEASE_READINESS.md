# gmweb release readiness

Generated: 2026-11-11T11:47:54.810Z
ok: true
rolloutAction: READY: docker compose restart gmweb (or headless variant) after change is accepted on STARTUP_REF=main
livePostRestart: UNAVAILABLE
installerByteParity: true
gm HEAD: f6a655ded929762414377b686dc07df2312f37bf
gm installer SHA256: 18318fed9c32d6625d7512e45a3c92278597745ba26cb98cd60ae5fc56e3d62e
gmweb vendored installer SHA256: 18318fed9c32d6625d7512e45a3c92278597745ba26cb98cd60ae5fc56e3d62e
sourceFingerprint: 7397241c7dabee04cf3ed190b4be4e2e741d3137d2fa0fc34c8cb075a8f753fe

## Commands

- root-check: `npm run check` exit=0 status=PASS counts=82/82,38/38,65/65,27/27,22/22,9/9,19/19
- startup-check: `npm --prefix startup run check` exit=0 status=PASS counts=82/82,38/38,65/65,27/27,22/22,9/9,19/19
- runtime-install: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-runtime-install.mjs` exit=0 status=PASS counts=38/38
- container-path: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-container-startup-path.mjs` exit=0 status=PASS counts=65/65
- rollout-docs: `/data/cache/node/node-v24.22.0-linux-x64/bin/node scripts/check-rollout-docs.mjs` exit=0 status=PASS counts=27/27
- post-restart-offline: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-post-restart.mjs --offline` exit=0 status=PASS counts=22/22
- post-restart-live: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-post-restart.mjs --live` exit=0 status=UNAVAILABLE counts=22/22
- gm-drift-watch-once: `/data/cache/node/node-v24.22.0-linux-x64/bin/node scripts/check-gm-upstream-drift.mjs --watch --once` exit=0 status=PASS counts=none
- probe-selftest: `npm run probe:post-restart` exit=0 status=PASS counts=none
- probe-fixtures: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-live-probe-fixtures.mjs` exit=0 status=PASS counts=none
- simulate-startup: `npm run simulate:startup` exit=0 status=PASS counts=19/19
- simulation-gate: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-simulated-startup.mjs` exit=0 status=PASS counts=19/19
- report-rollout: `npm run report:rollout` exit=0 status=PASS counts=none
- validate-rollout-report: `npm run validate:rollout-report` exit=0 status=PASS counts=none
- sha256-parity: `sha256sum docker/install-gm.sh /workspace/gm/scripts/install.sh` exit=0 status=PASS counts=none
- node-check-js: `/data/cache/node/node-v24.22.0-linux-x64/bin/node --check startup/check-release-readiness.mjs` exit=0 status=PASS counts=none
- bash-n-start: `bash -n startup/start.sh` exit=0 status=PASS counts=none
- bash-n-root-startup: `bash -n startup.sh` exit=0 status=PASS counts=none
- sh-n-installer: `sh -n docker/install-gm.sh` exit=0 status=PASS counts=none
- git-diff-check: `git diff --check` exit=0 status=PASS counts=none
- hidden-token-scan: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-hidden-tokens.mjs` exit=0 status=PASS counts=none
- active-forbidden-grep: `grep -RInE agentgui@1\.0\.1126|agentgui@latest|bunx.*agentgui@|npx -y agentgui startup docker Dockerfile Dockerfile.headless --exclude=check-*.mjs --exclude=validate-*.mjs --exclude=rollout-report.mjs --exclude=live-post-restart-probe.mjs --exclude=gm-install.log` exit=1 status=PASS counts=none
- ps-survivor-scan: `/data/cache/node/node-v24.22.0-linux-x64/bin/node startup/check-survivors.mjs` exit=0 status=PASS counts=none

Decision: `ok: true` means every deterministic gate passed. `UNAVAILABLE` for the live post-restart probe is allowed and means no local deployment was reachable.
Artifacts: `docs/RELEASE_READINESS.json` and `docs/RELEASE_READINESS.md`. Validator: `npm run validate:release-readiness`.
