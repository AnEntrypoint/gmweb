# Workspace release context

Generated: 2026-11-11T12:41:19.327Z
ok: true
decision: WORKSPACE_CONTEXT_OK: gmweb release readiness remains READY; peers are reported but not modified
sourceFingerprint: `9815a8caf6242aac7c3db793cd5e9dcb87fef4107b4c136a627c3654863319d5`
gm HEAD: `6f57313df68d9dc897415e593111ffd311ec6657`
gm installer SHA256: `18318fed9c32d6625d7512e45a3c92278597745ba26cb98cd60ae5fc56e3d62e`

## Peer artifacts

| name | status | ok | blocking | hash | next action |
|---|---|---|---|---|---|
| gmweb-release-readiness | PASS | true | false | 964bbc269e76 | None; rolloutAction READY |
| oscraft-release | PASS | true | false | e8f5106d49dc | None |
| bitvoice-release | PASS | true | false | 2c7a138e2aae | Generate Bitvoice release artifact when ready |
| bitvoice-service-contract | PASS | true | false | f26ca47439d6 | Use as fallback contract until release artifact exists |
| bitvoice-lock | UNAVAILABLE | null | false | none | Generate lock when peer release is finalized |
| wscheppity-extraction | PASS | true | false | aac38900903c | None |
| wscheppity-vendor-ready | PENDING | null | false | none | 247420 vendors wscheppity only after READY.json ok=true; no gmweb action |
| extra-extraction | PASS | true | false | 279dfcf88a61 | None |
| extra-status | UNAVAILABLE | null | false | none | Generate status when extraction finalizes |
| bota-coordination | PASS | true | false | 327f78a0b8ff | None |
| hy3d-content | PASS | true | false | ebbff59684d6 | None |
| hy3d-delivery | PASS | true | false | d3e41343ad78 | None |

PENDING: wscheppity-vendor-ready
UNAVAILABLE: bitvoice-lock, extra-status
BLOCKING: none

Command: `npm run check:workspace-release -- --watch --once`; validator: `npm run validate:workspace-release`.
This packet reads peer artifacts only. Missing optional artifacts are informational; present red artifacts block.
