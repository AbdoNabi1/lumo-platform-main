# Ory Network project config (Task 4 deliverables)

Committed for reproducibility and review — the Ory Network project itself is the source of truth
once configured; these files are what should be uploaded there, not read by any code in this repo.

- **`permissions.opl.ts`** — the OPL (Ory Permission Language) namespace definition. Uploaded via
  `ory patch opl --file permissions.opl.ts --project <id>` or pasted into Ory Console →
  Permissions → Configure → Permission Rules. **Not yet uploaded** to the live project as of
  2026-09-04 — needs a Workspace API key (`ory_wak_...`), a different credential than the
  project-scoped `ORY_API_KEY` already in `.env`. See `docs/operations/CLOUD_RUNBOOK.md` §3.2 for
  the exact unblock steps.
- **`identity.schema.json`** — a copy of `infrastructure/docker/kratos/identity.schema.json`
  (self-hosted Kratos's identity schema), kept here for the record. **Not currently referenced by
  anything**: `scripts/ops/seed-ory-network.mjs` defaults `SCHEMA_ID` to Ory Network's built-in
  `preset://email` schema instead, which is sufficient for this platform's needs (only `email` +
  password credentials, no other traits). This file only matters if that default is ever
  overridden — via `ORY_IDENTITY_SCHEMA_ID`, after uploading this schema to the project (Identity →
  Identity Schema → Create new schema in the Ory Console) and setting the env var to the resulting
  schema ID. Until then, treat it as an unused reference copy, not a wired configuration.
