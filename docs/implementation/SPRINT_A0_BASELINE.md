# Sprint A0 — Frozen Baseline

**Status: FROZEN.** This document is the permanent record of Sprint A0 (Preconditions) as
accepted and committed. Per instruction, no file this sprint touched is to be modified again
unless a future sprint explicitly supersedes it — any such change must reference this document
and explain the supersession.

---

## 1. Commit and tag

|                           |                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **Commit hash (full)**    | `2dc8e0b9ba90517039a7240861535fb53127fbee`                                              |
| **Commit hash (short)**   | `2dc8e0b`                                                                               |
| **Tag**                   | `sprint-a0-complete` (annotated, points at the commit above)                            |
| **Branch**                | `main`                                                                                  |
| **Author date / message** | `feat(platform): implement Sprint A0 infrastructure foundations` (Conventional Commits) |
| **Files in commit**       | 24 (4519 insertions, 19 deletions)                                                      |

---

## 2. Affected packages

| Package                                      | Role in Sprint A0                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/messaging`                        | `EventHandler.handleAtomic` opt-in capability; `EventConsumer` atomic path; new `DuplicateProcessedEventError`; new `@platform/repository` dependency          |
| `@platform/kafka`                            | `KafkaConsumerRuntime` atomic path (production consumer runtime); new `@platform/repository` dependency                                                        |
| `@platform/db`                               | New migration (schema declarations for `inventory`/`payments` were edited in-place, isolated from unrelated pre-existing pollution in the same files — see §7) |
| `@platform/inventory` (`services/inventory`) | `InventoryItemRepository.findByReservationReference` (domain port + Prisma + in-memory adapters)                                                               |
| `@platform/payments` (`services/payments`)   | `PaymentIntentRepository.findByIdempotencyKey` (domain port + Prisma + in-memory adapters)                                                                     |

No other package's committed content changed. (`@platform/shipping`, `@platform/security`, and
`@platform/runtime`'s tracking module were touched in the working tree but explicitly excluded
from this commit — see §6.)

---

## 3. Migrations

**File:** `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`

Committed content — **2 of the originally-reviewed 3 steps** (Step 3 deferred, see §6):

```sql
CREATE UNIQUE INDEX "reservations_tenant_id_item_id_reference_key"
  ON "inventory"."reservations"("tenant_id", "item_id", "reference");

ALTER TABLE "payments"."payment_intents" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "payment_intents_tenant_id_idempotency_key_key"
  ON "payments"."payment_intents"("tenant_id", "idempotency_key");
```

- **Step 1 (Reservation)** requires the pre-migration duplicate-audit query in
  `SPRINT_A0_REPORT.md` §4 to return zero rows before this migration is applied to a database with
  production data.
- **Step 2 (PaymentIntent)** is safe to apply without an audit (new nullable column, NULL-safe
  unique index).
- Neither step has been applied to any database — this environment has no live Postgres host. Both
  are validated as syntactically-reviewed SQL only.

---

## 4. Governance baseline

The pre-commit governance gate (`scripts/governance/run.mjs`, `FF-API-01` public-API-stability
check) requires a baseline snapshot to compare against. That baseline system is itself pre-existing
uncommitted tooling (not part of any commit, Sprint A0's or otherwise — confirmed via
`git ls-files -- scripts/governance/baseline/` returning zero results). It was regenerated via
`pnpm governance:update` against the full working tree (the sanctioned "reviewed approval act" per
`scripts/governance/README.md`) so the hook would evaluate Sprint A0's additive API changes
correctly, then left **on disk, untracked** — consistent with its pre-existing state, not part of
this commit.

| Baseline file                                   | Git blob hash (`git hash-object`) at freeze time |
| ----------------------------------------------- | ------------------------------------------------ |
| `scripts/governance/baseline/dependencies.json` | `3dcd3a109b266a2b42b0aefb17fe9af7c2fb6bc4`       |
| `scripts/governance/baseline/events.json`       | `ac11f1a08c4dca1cebc8ca5fa717cf6327f0fa92`       |
| `scripts/governance/baseline/public-api.json`   | `c04ff75b40dfce690f00e762d5af8b3dc5338d48`       |

`FF-API-01` reported **2693 public exports guarded across 76 packages, 0 blocking findings**
against this baseline at commit time.

---

## 5. Quality gates (at commit time)

| Gate                                                                          | Result                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-commit hook (husky: lint-staged + `pnpm governance`)                      | **PASS** — commit `2dc8e0b` succeeded                                                                                                                                           |
| `FF-TYPE-02/03/04` (type safety, no `any`/suppressions)                       | PASS                                                                                                                                                                            |
| `FF-CX-01` (complexity budget)                                                | PASS                                                                                                                                                                            |
| `FF-DEP-01` (dependency freeze)                                               | PASS                                                                                                                                                                            |
| `FF-API-01` (public API stability)                                            | PASS (0 blocking findings, re-baselined)                                                                                                                                        |
| `FF-EVT-01` (event contract, no removed event types)                          | PASS                                                                                                                                                                            |
| `FF-ARCH-07/09/14/15/16/17`, `barrel-export`, `governance-docs`, `adr-status` | PASS                                                                                                                                                                            |
| `knowledge-index` (generated docs current)                                    | WARN (2) — pre-existing, unrelated to Sprint A0, not fixed (`docs/generated/KNOWLEDGE_INDEX.md`, `ENGINEERING_METRICS.md` stale; regenerating them is out of Sprint A0's scope) |
| `pnpm --filter <5 touched packages> typecheck`                                | PASS, 0 errors                                                                                                                                                                  |
| `pnpm --filter <5 touched packages> test -- --run`                            | PASS, all tests green (verified twice: once against the full working tree, once in full `git stash` isolation against `HEAD` + staged content only)                             |
| `pnpm arch` (dependency-cruiser)                                              | PASS, 0 violations                                                                                                                                                              |
| `pnpm --filter <touched packages> lint`                                       | PASS on every Sprint A0 file (2 pre-existing failures found elsewhere, confirmed unrelated — see `SPRINT_A0_REPORT.md` §5)                                                      |

Full evidence trail: `SPRINT_A0_REPORT.md`, `SPRINT_A0_ARCHITECTURE_REVIEW_PACK.md`,
`SPRINT_A0_REVIEW_PACK_APPENDIX.md`.

---

## 6. ADRs touched

**None modified or created.** Sprint A0 conceptually implements the opt-in atomic-idempotency
pattern that **ADR-0005** already specifies (the `tx?` parameter convention); no ADR text changed.
No new architectural decision was introduced that would require a new ADR.

---

## 7. Deferred items

Full detail in `docs/implementation/SPRINT_A0_DEFERRED_ITEMS.md`. Summary:

| Item                                                                    | Reason                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema/shipping.prisma` (idempotency_key column)    | `services/shipping/` has zero committed files — no valid base to isolate Sprint A0's hunk against |
| `services/shipping/src/domain/shipment-repository.ts`                   | Same — `ShipmentRepository` interface itself is uncommitted                                       |
| `services/shipping/src/infrastructure/prisma-shipment-repository.ts`    | Same                                                                                              |
| `services/shipping/src/infrastructure/in-memory-shipment-repository.ts` | Same                                                                                              |
| `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts`  | Depends on the deferred in-memory repository above                                                |
| `migration.sql` Step 3 (Shipment `idempotency_key`)                     | Alters `shipping.shipments`, whose own creation migration is also uncommitted                     |

All deferred content remains present, unmodified, in the working tree (not deleted, not reverted)
— ready to commit alongside the Shipping context's own base commit.

---

## 8. Known limitations

1. **Reservation migration requires a pre-deploy audit.** `Step 1` of the migration cannot be
   safely applied to a database with production data until the duplicate-audit query in
   `SPRINT_A0_REPORT.md` §4 has been run and returns zero rows (or any duplicates found have been
   resolved).
2. **No migration has been applied to any real database.** This environment has no live Postgres
   host; both migration steps are reviewed SQL only, never executed.
3. **The two new repository methods are dormant by design.** `findByReservationReference` and
   `findByIdempotencyKey` are unreferenced by any `UseCase` (proven in the review pack appendix
   §4/§7) and, for `findByIdempotencyKey`, the in-memory adapter always returns `null` — the
   `PaymentIntent` domain aggregate carries no `idempotencyKey` field yet. This is intentional
   (Sprint A3's job), not a defect.
4. **The governance baseline is untracked.** It exists on disk to satisfy the pre-commit hook but
   is not part of any commit. A future session that clones this repo fresh (or otherwise lacks this
   working tree's untracked files) will need to run `pnpm governance:update` before its first
   commit, or the pre-commit hook will report `baseline missing`.
5. **`git status` is not clean.** See the verification note in the freeze confirmation — this repo
   carries a large volume of pre-existing uncommitted work, entirely unrelated to and untouched by
   Sprint A0, predating this session. Freezing Sprint A0 does not and should not resolve that
   separately-tracked condition.
6. **Working-tree drift risk.** Because the deferred Shipping hunks (§7) remain uncommitted in the
   same working tree as ongoing unrelated work, a future session must re-verify they are still
   present and unmodified before building the Shipping base commit on top of them.
