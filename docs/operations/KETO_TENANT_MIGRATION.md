# Keto tenant migration (G-70) — operator runbook

**Status: the code is landed; the live tuples are NOT migrated until you run this.** G-70 is
"code-complete, migration pending" in `docs/architecture/23-platform-gap-register.md`, and
`TENANT_MODE=multi` stays forbidden until step 3 below has run against the live Ory Network project.

## What changed, in one paragraph

A Keto grant used to be `(permissions, <permission>, granted, <principal id>)` — no tenant, so a grant
for one tenant allowed that principal in every tenant. It is now
`(permissions, tenant/<tenantId>/<permission>, granted, <principal id>)`. The subject stays the bare
principal id (Kratos ids are globally unique). **The code already reads the qualified object**
(`objectFor` in `packages/auth/src/keto.ts`; `KetoRelationshipCheck` in
`apps/runtime/src/security/ory-adapters.ts`) and **already writes both** the bare and the qualified
tuple (the three seed scripts and `relation-sync.consumer.ts`, write and delete). What is left is the
tuples that already exist in the live project: they are bare, so reads no longer see them.

## Read this before anything else

- **Nothing is deployed** (`TENANT_MODE=single` everywhere, no deployment), so landing this code is
  safe. The exposure is a developer running the runtime **locally against the shared Ory Network
  project** (`ORY_SDK_URL` / `KETO_READ_URL` in `.env`): with the read switch merged and the backfill not
  yet run, **every permission check for the seeded operator is denied** and the admin console 403s.
  Run step 1 before anyone pulls this code and points a runtime at the shared project, or tell them to
  re-run `seed-ory-network.mjs` (which now writes both twins for the seeded operator).
- Local dev Keto is `dsn: memory` and is wiped on restart. Re-running `scripts/dev/seed-auth-local.mjs`
  (or `apps/e2e/scripts/seed-e2e-identities.mjs`) writes both twins. **Nothing to migrate locally.**
- **I have not run any of this against Ory.** The scripts are tested against a fake Keto that speaks the
  same REST shapes, and exercised end to end against a throwaway localhost server. They have never
  talked to the real project. The first thing that can surprise you is the listing call — see
  "If the listing fails" below.
- The scripts need `ORY_SDK_URL` and `ORY_API_KEY` in the environment (the same two the seed script
  uses), and `--tenant <id>`: **the tenant the existing bare grants belong to**. There is deliberately
  no default. Today that is the runtime's `TENANT_DEFAULT_ID`, `tenant-local` unless you overrode it.
  All examples below use `tenant-local`.

## The three commands, in order

Every command is dry-run unless it says `--apply`. Run the dry-run first and read it.

### 1. Backfill — a qualified twin for every bare tuple

```bash
node scripts/ops/ory-keto-backfill.mjs --tenant tenant-local
node scripts/ops/ory-keto-backfill.mjs --tenant tenant-local --apply
```

Dry-run prints `Backfill tenant "tenant-local": N bare tuple(s), M need a twin.` and one
`would PUT tenant/tenant-local/<permission>  granted  <subject>` line per missing twin, then
`DRY RUN — nothing written.` and exits 0. With `--apply` it PUTs those tuples (a PUT is an upsert, so
re-running is safe and a second run writes nothing) and ends `Wrote M qualified tuple(s). Now run the
count gate.`

### 2. Count gate — the interlock

```bash
node scripts/ops/ory-keto-count-gate.mjs --tenant tenant-local
```

Read-only (so it takes no `--apply`). Prints the totals, then a per-permission table and a per-subject
table (`N bare  N qualified  <name>  ok|MISMATCH`), then one line per problem tuple:

- `MISSING TWIN <object> <relation> <subject>` — a bare tuple with no qualified twin. **This is the
  dangerous one**: after step 3 it fails closed and locks that subject out.
- `ORPHAN TWIN <object> <relation> <subject>` — a qualified tuple with no bare tuple. Not dangerous to
  delete, but the gate requires an **exact** match, so it fails until you explain it (usually a grant
  made after the backfill by a writer that only wrote the qualified side).

It compares (relation, permission, subject), not just counts, so two subjects swapping places cannot
pass. Other tenants' twins are counted and ignored.

| Exit | Meaning                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- |
| 0    | `PASS: bare and qualified match exactly.` (or `PASS (nothing at risk)`: no bare tuples remain) |
| 1    | `FAIL: bare and qualified do NOT match` — or the namespace is empty (wrong project/key?)       |
| 2    | usage error, missing credentials, or Ory/transport error                                       |

**Do not go to step 3 unless this exits 0.**

### 3. Delete the bare tuples

```bash
node scripts/ops/ory-keto-delete-bare.mjs --tenant tenant-local
node scripts/ops/ory-keto-delete-bare.mjs --tenant tenant-local --apply
```

It recomputes the gate itself on a fresh listing — it does not trust that you ran step 2 — and prints
`REFUSING to delete bare tuples: the count gate did not pass` (exit 1, nothing deleted) if it fails.
When it passes, the dry-run lists `would DELETE <permission> …` for every bare tuple and exits 0;
`--apply` deletes them (`Deleted N bare tuple(s).`). Re-running it afterwards prints
`Nothing to delete: no bare tuples remain.` and exits 0.

Deleting is what closes the gap's live half: it removes the tuples that no read looks at any more. After
it, run step 2 once more and expect `PASS (nothing at risk)`.

**Decision cache:** `CachedAccessControl` holds allow/deny decisions for 30 seconds, so a runtime that
was already up can serve a stale decision for up to that long after any step.

## What breaks if they run out of order

| You did                                                       | What happens                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ran the new code against the shared project **before step 1** | Every check is for `tenant/<tenant>/<permission>`, which does not exist yet, so **every check is denied**, including the seeded operator's. Nothing is lost — run step 1 (or re-run the seed) and it recovers within the cache TTL.                                                                                      |
| Ran **step 3 without a passing gate**                         | `delete-bare` refuses on its own, so you cannot do this through the script. If you delete bare tuples some other way, any bare tuple with no twin is **gone with nothing left to read**: that subject is denied everywhere, for good, until it is re-granted. For the seeded operator that is locked out of the console. |
| Ran step 1 **after** step 3                                   | Nothing to backfill from: the bare tuples are gone, so there is nothing to copy.                                                                                                                                                                                                                                         |
| Skipped step 1 but ran step 3 (via the script)                | Refused (`MISSING TWIN` for every tuple), exit 1, nothing deleted.                                                                                                                                                                                                                                                       |

**Recovery, in every case: re-run the seeds.** They are idempotent and now write both twins:
`ADMIN_DEV_PASSWORD=… node scripts/ops/seed-ory-network.mjs` re-grants the seeded operator's full
permission set (bare and qualified). Grants that were made through Security's relation API (not seeded)
have to be re-issued through it, because the consumer writes both twins from the event. If Postgres still
holds the tuples (`security` relation-tuple table, tenant-scoped), that is the record of what to
re-issue.

## Ory Network drops writes it has acknowledged — the scripts now verify every one

**Observed on the first live run (2026-09-21).** The backfill issued 65 PUTs; Ory answered 2xx to all
65 and persisted only the first 19. A re-run of the 46 still missing persisted the first 11. A
read-only diagnostic confirmed it was the writes, not the listing: both page sizes listed the same
tuples, and a direct lookup of the 20th twin returned nothing. The count gate caught it both times and
the delete refused, so nothing was lost.

So a 2xx is not treated as proof. The backfill and delete-bare now read every tuple back after
writing or deleting it, retry with backoff (1 s up to 16 s) until the effect is observed, and pause
between tuples. A write that never lands **stops the run with exit 2**: everything before it is
verified, and re-running the same command resumes, because both are idempotent. The output says
`verified n/N` per tuple. If you see `not observed yet, retrying`, that is the protection working, not
a failure.

## If the listing fails

The scripts list tuples with `GET <ORY_SDK_URL>/relation-tuples?namespace=permissions`. The seed script's
own notes record that the Ory Network **read** side returned HTTP 403 with the project API key on
2026-09-04, and that the OPL `permissions` namespace had not been uploaded to the project. If either is
still true, the listing fails, the scripts print `list relation-tuples failed: HTTP <status> …`, exit 2
and **write nothing**. That is a blocker on the Ory side (workspace key / OPL upload; see
`docs/operations/CLOUD_RUNBOOK.md`), not a reason to bypass the gate.

## After the migration

- `TENANT_MODE=multi` is **still not enabled by this**: G-64 (the worker refuses multi) and G-68's
  legacy-storage-key count are separate. Update the register's G-70 row from "code-complete, migration
  pending" to closed only after step 3 has run and the post-delete gate is green — record the date and
  the gate output.
- **Contracted 2026-09-21.** The four writers (the three seeds and `relation-sync.consumer.ts`) now
  write the tenant-qualified tuple only. A gate run from here on should report
  `PASS (nothing at risk)` — "contracted": no bare tuples. A bare tuple reappearing means something
  still writes the old shape. `seed-ory-network.mjs` paces and reads back every grant, for the same
  silent-drop reason as the backfill.
