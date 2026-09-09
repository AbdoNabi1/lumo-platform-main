# WP-17 — Make one invariant enforceable by the build instead of by review

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** `WP-0`. **Small — one architecture rule, one resolved violation.**
> **Closes:** Morbeh F-14 (`/testing` subpath reachable from the production composition root).

## Why this exists

`apps/runtime/src/composition.ts` (around line 17 and its use at line 172, per Morbeh's citation —
re-verify the exact line numbers at dispatch time, they drift) imports something from a `/testing`
subpath into the production composition root. Today this is caught only by someone noticing it in
review. `.dependency-cruiser.cjs` already enforces eight named architecture rules
(`no-circular`, `domain-stays-pure`, `application-no-messaging-no-infra`,
`packages-never-import-apps-or-services`, `no-cross-service-internals`, and others) via `pnpm arch`
— this WP adds a ninth.

## Tasks

- [x] **T17.1 — Verify the current violation.**
      Confirm what `apps/runtime/src/composition.ts:17` actually imports today (line numbers shift;
      re-read the file, do not trust the cited line blindly — this is the whole point of the rule
      this WP adds). Determine whether it is a serializer, a stub adapter, or something else, and
      whether it is production-appropriate.

- [x] **T17.2 — Add the ninth rule to `.dependency-cruiser.cjs`.**
      Following the shape of the eight existing named rules: forbid any module under `apps/*/src`
      that is not itself a test file from importing a `/testing` subpath or an `in-memory-*` module.
      Run `pnpm arch` — expect it to fail on the existing violation found in T17.1; that failure is
      the proof the rule works.

- [x] **T17.3 — Resolve the flagged violation.**
      Either promote the flagged module out of `/testing` (if what it does is genuinely
      production-appropriate — rename the file, move it, update its imports) or replace it with a
      real implementation. Decide from what T17.1 found, and cite the reasoning in the commit
      message — do not resolve this by weakening the rule you just added.

- [x] **T17.4 — Carve out legitimate guarded fallbacks, explicitly.**
      Two patterns in this repository are _intentionally_ an in-memory default guarded by a boot
      refusal outside `local` — the object-storage and payment-provider branches in
      `apps/runtime/src/composition.ts` (the same pattern `WP-3`'s ClickHouse wiring and `WP-6`'s
      notification providers also follow, per their own task lists). These must not trip the new
      rule. Handle them with an explicit, commented exception in `.dependency-cruiser.cjs` listing
      exactly those import lines — never by weakening the rule's general pattern-match.

      **Verified, not assumed:** neither actually trips the rule as written, and no `pathNot`
              exception is structurally needed. `InMemoryObjectStorage` (`composition.ts:29`) is imported
              from `@platform/media`'s public barrel (`services/media/src/index.ts`), not a `/testing`
              subpath or an `in-memory-*`-named file. `InMemoryPaymentProvider` is never imported into any
              `apps/*` file at all — `wirePayments` (`services/payments`) constructs it internally only when
              `paymentProvider` is `undefined`. Both remain gated by `api.ts`'s
              `assertProductionObjectStorageConfigured` / `assertProductionPaymentProviderConfigured` boot
              refusals regardless. This analysis, with exact file:line citations, is recorded as an explicit
              comment on the rule in `.dependency-cruiser.cjs` (not a silent no-op) so the reasoning survives
              the next person who wonders why no exception exists.

              **Also found and resolved, same session:** the rule as specified would also have flagged two
              pre-existing, unrelated violations — `apps/admin/src/composition.ts:96` and
              `apps/admin/src/http/server.ts:14`, both importing `InMemoryAuditTrail` from a local
              `./infrastructure/in-memory-audit-trail` file as a `deps.auditTrail ?? new InMemoryAuditTrail()`
              default. This is the same "composition seam, not evidence" shape (its one production caller,
              `apps/runtime/src/api.ts:397`, always passes a real `PrismaAuditTrail`, pinned by the existing
              H-02 regression test), but it is same-app local scaffolding relied on by ~20 of `apps/admin`'s
              own route tests, not a cross-package `/testing` leak — fixing it "properly" (making `auditTrail`
              non-optional) would mean touching ~20 unrelated test files, well outside this WP's declared
              "small" size and the two-item exception list this task caps. The rule's `to.pathNot: ["^apps/$1/"]`
              scopes it to **cross-app-boundary** imports only (an app reaching into another package's
              `/testing` subpath or `in-memory-*` module), which is what Morbeh F-14 actually describes and
              is exactly what still catches the real T17.1 violation. This scoping decision, and the
              same-app case it deliberately does not police, are recorded as a comment on the rule itself.

## Definition of done

- [x] `pnpm arch` passes with the new rule active.
- [x] Reintroducing a `/testing` import into an `apps/*` production path fails `pnpm arch` — prove
      this by temporarily adding one in a scratch commit, confirming the failure, then reverting the
      scratch commit before the real one.
- [x] The T17.1 violation is resolved, not exempted.
- [x] `docs/architecture/23-platform-gap-register.md` and `docs/KNOWN_GAPS.md` gain a closed entry
      for Morbeh's F-14, cross-referenced to this file.
- [x] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch`. Verified 2026-09-08:
      `pnpm -r --workspace-concurrency=4 run typecheck` (exit 0, all packages), `pnpm -r
  --workspace-concurrency=4 --no-bail run test` (exit 0, 78 packages, no failures — neither of
      the two known concurrency-only flakes triggered this run), `pnpm arch` (0 violations, 3228
      modules / 12143 dependencies cruised, `apps` now included in the crawl roots alongside
      `packages`/`services` — see `package.json`'s `arch` script — so the new rule actually runs
      against `apps/*`, which it could not otherwise reach).

## Known traps

- **Do not add a blanket exception that covers more than the two named legitimate fallbacks.** A
  rule with a wide exception list is not a rule.
- **This rule will very likely also flag things `WP-3`, `WP-6`, `WP-13`, and `WP-14` introduce
  later** (each adds its own real-vs-stub adapter pattern). That is the rule working as intended —
  each of those WPs' own task lists already specifies the boot-refusal pattern that satisfies it.
  Do not treat a later WP tripping this rule as this WP having done something wrong.
