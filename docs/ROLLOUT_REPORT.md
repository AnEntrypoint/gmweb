# gmweb rollout report

Generated: 2026-11-11T11:05:08.520Z
ok: true

## State

- gmweb HEAD: `2eb6599e3d2bc0ec2f72413e4ca744b8105aa474` (dirty worktree)
- gm HEAD: `f6a655ded929762414377b686dc07df2312f37bf`
- gm installer SHA256: `18318fed9c32d6625d7512e45a3c92278597745ba26cb98cd60ae5fc56e3d62e`
- gmweb vendored installer SHA256: `18318fed9c32d6625d7512e45a3c92278597745ba26cb98cd60ae5fc56e3d62e`
- byte parity: true
- active AgentGUI spec: `github:AnEntrypoint/agentgui#main`
- offline post-restart: OFFLINE_PLAN_VALID
- live post-restart: UNAVAILABLE
- live probe SELFTEST: 4/4
- explicit probe: `npm run probe:post-restart -- --url <base> --log <path>`
- simulated startup: PASS (19/19)
- simulation command: `npm run simulate:startup`

## Gate counts

- static-source: 82/82, exit=0, status=PASS
- runtime-install: 38/38, exit=0, status=PASS
- container-startup-path: 65/65, exit=0, status=PASS
- rollout-docs: 27/27, exit=0, status=PASS
- post-restart-offline: 22/22, exit=0, status=OFFLINE_PLAN_VALID
- post-restart-live: 22/22, exit=0, status=UNAVAILABLE
- gm-upstream-drift: 9/9, exit=0, status=PASS
- live-probe-selftest: 4/4, exit=0, status=SELFTEST
- live-probe-fixtures: 16/16, exit=0, status=PASS
- simulated-startup: 19/19, exit=0, status=PASS
- simulated-startup-gate: 13/13, exit=0, status=PASS

## Rollout

- Production: `docker compose restart gmweb`
- Headless: `docker compose -f docker-compose.headless.yaml restart gmweb-headless`
- Rollback: Revert changed files on main (or deployment STARTUP_REF), then repeat the same container restart.
- Drift action (manual only): `cp /workspace/gm/scripts/install.sh /workspace/gmweb/docker/install-gm.sh`

This report is offline and non-destructive. See `docs/POST-RESTART.md` and `docs/CONTAINER-ROLLOUT.md`.
