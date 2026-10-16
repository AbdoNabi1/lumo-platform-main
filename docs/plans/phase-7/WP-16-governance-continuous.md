# WP-16 — Governance, run continuously

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing hard. **Not a phase — a checklist that attaches to whichever WP first
> makes each item relevant.** Do not treat this as a WP to run start-to-finish in isolation; do not
> let it block anything else in this roadmap.
> **Closes:** Morbeh F-09 (DLQ store is durable and wired; alerting and operator replay absent).
> Partially closes Morbeh F-14 — the architecture-rule half is `WP-17`; this file covers the
> operational half of the same finding where one exists.

## Why this exists

Several operational gaps are real, verified, and each one is small enough that bundling them into
one artificial "governance sprint" would either delay them behind unrelated work or get them
delayed by it. Each item below names the WP whose completion first makes it worth doing, so it gets
picked up in context rather than forgotten.

## Items

- [ ] **G16.1 — DLQ alerting and operator replay (F-09).**
      `apps/runtime/src/composition.ts:523,580` (verify these lines at dispatch time — they drift)
      shows the DLQ store is durable and wired; nothing alerts when something lands in it, and
      there is no authorized, idempotent, audited replay workflow for an operator to use. Build:
      an alert (through whatever monitoring this repository already uses — check
      `infrastructure/docker/docker-compose.yml`'s Prometheus/Grafana services before adding a new
      alerting path) on non-empty DLQ depth per topic, and a replay use case requiring an
      authenticated operator, idempotent against the message's original dedup key, and fully
      audited through the existing `AuditTrail` port. **Attach this to whichever of `WP-2`, `WP-9`,
      or `WP-11` first adds a new consumer with a meaningful DLQ risk** — do it alongside that work,
      not as a separate pass over already-shipped consumers.

- [ ] **G16.2 — Kafka production TLS and SASL.**
      Secret-manager integration and certificate rotation for the Kafka brokers. Attach this when
      `WP-2`'s collector or `WP-3`'s ingestion consumer is first deployed somewhere that is not
      local infra (`pnpm dev:up:infra`) — there is no reason to harden transport security before
      there is a non-local deployment to harden.

- [ ] **G16.3 — Kafka schema versioning.**
      Compatibility and breaking-change checks for event schemas. Attach this to `WP-2` (which
      defines the canonical event names and shapes for the first time in a way that matters beyond
      this codebase) — retrofit it onto an established event catalog is more expensive than building
      it in alongside the catalog itself.

- [ ] **G16.4 — Processed-event retention and archival.**
      With consumer-group isolation, so archiving one consumer's processed-event history does not
      affect another's replay window. Attach this once `WP-3`'s ClickHouse ingestion consumer and
      `WP-11`'s finance consumers are both live — retention policy is easier to size once there are
      at least two real, differently-shaped consumers to measure against.

- [ ] **G16.5 — Tenant-correlated tracing.**
      Across payment, event, AI-cost, and queue paths. This item is meaningless before `WP-10`
      makes tenant a real per-request concept — attach it to `WP-10`'s T10.7 cross-cutting sweep,
      which already walks every shared singleton asking "is this keyed by tenant?"; tracing context
      is exactly that kind of singleton and belongs in the same sweep, not a separate pass.

- [ ] **G16.6 — Backup, restore rehearsal, and zero-downtime migration procedure.**
      For the full model set (40-41 Prisma schema files as of this roadmap — re-glob before
      trusting the count). This is the one item here with no natural WP to attach to; run it as its
      own small effort once `WP-11`'s financial migration (a real, moderately risky schema change)
      has landed, using that migration as the rehearsal's live test case rather than a synthetic
      one.

- [ ] **G16.7 — Services documentation reconciliation.**
      Each WP that closes a gap should update the same status documents `WP-0` corrected
      (`README.md`, `docs/PROJECT_STATE.md`, `docs/KNOWN_GAPS.md`,
      `docs/architecture/23-platform-gap-register.md`) rather than leaving that to a final sweep.
      Every WP file in `docs/plans/phase-7/` and this roadmap's WP-11 through WP-17 already has a
      "close the gap in the register" line in its Definition of Done — this item exists only to
      flag it if a WP is merged without doing so. Check the register after any WP lands; if its
      gap is still open, that WP is not actually done regardless of what its own checklist says.

## Definition of done

There is no single "done" for this file — it is closed item by item, each verified against the WP
it attached to:

- [ ] F-09: DLQ alerting fires on non-empty depth; replay is authorized, idempotent, and audited.
- [ ] Each remaining item (G16.2–G16.6) is either closed with a citation to the commit/PR that
      closed it, or still open with a note of which upcoming WP it is attached to.
- [ ] `docs/architecture/23-platform-gap-register.md` has no gap whose "Due" column names a WP that
      has since shipped without that gap being marked closed or explicitly re-scoped.

## Known traps

- **Do not let this file become an excuse to defer something that actually belongs in the WP doing
  the related work.** If a WP's own "Definition of done" already requires an operational property
  (e.g. `WP-3`'s "runtime refuses to boot outside `local` with ClickHouse unconfigured"), that
  belongs to that WP, not here — this file is for genuinely cross-cutting operational debt with no
  natural single owner.
- **Do not batch these into one commit or one PR.** Each attaches to a different WP's timeline;
  bundling them creates a diff that touches unrelated parts of the system for no shared reason.
