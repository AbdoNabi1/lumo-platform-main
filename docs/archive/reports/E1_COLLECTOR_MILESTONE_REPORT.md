# E1 — Collector App Milestone Report

**Status: Landed in full.** Prior conclusions (`CHECKPOINT_1_REPORT.md`: "Confidence is Medium
(context-level only); not re-verified to High. No architecture doc in `docs/` defines what E1/E2
are") did not survive re-investigation — the same pattern as K7 and the Integration Sprint findings.

## What `apps/collector` is

The public tracking collector (P0-1/P0-2) — the first-party HTTP entrance for browser-emitted
events. A small (6 files), deliberately minimal Fastify app: `main.ts` (composition root, fails
closed on missing `COLLECTOR_WRITE_KEYS`/`COLLECTOR_ALLOWED_ORIGINS`/`KAFKA_BROKERS`, connects to
Kafka at boot rather than per-request), `server.ts` (one route, `POST /collect` + health checks,
deliberately not built on `@platform/http` since no auth/tenant/rate-limit machinery belongs on a
public anonymous beacon), `collector-endpoint.ts` (calls `collect()` from `@platform/tracking` and
publishes one `tracking.event.captured.v1` per request, answering 503 rather than a false 202 on
broker failure), `write-key-registry.ts` (maps a public, non-secret write key to a tenant
server-side).

## Evidence

- **ADR-0059** (Accepted) — "TypeScript Collector Runtime," Phase P5/M6 task P0-2, defines
  `apps/collector` by path as "a transport host" with no parsing/validation/resolution logic of its
  own.
- **`docs/DECISIONS.md` D-081** — records ADR-0059, names `apps/collector` by path.
- **`docs/implementation/P5_M6_TRACKING_RUNTIME_COMPLETION_REPORT.md`** §12 ("P0-1 — the public
  Collector") and Addendum II §16 ("P0-2 — ADR-0059") — a full completion report with gate numbers
  matching the actual files (`pnpm test` "...collector 13...", matching the source tree's own
  `.turbo` log exactly: 13/13 tests passing).
- **`docs/architecture/TRACKING_ARCHITECTURE.md`** §2.2 and its component-status table — lists
  `apps/collector/` as "Implemented."
- **`docs/DECISIONS.md` D-082 / FF-TRACK-01** — names `apps/collector/` as one of exactly four
  layers permitted to reach a vendor path.
- **Self-corroboration from already-committed history**: `packages/tracking/src/collector/collector.ts`
  (landed in the K7-partial commit, `c24ec9b`) states directly: _"Declared in the package rather
  than in either app because the producer (`apps/collector`) and the consumer (`apps/runtime`) are
  separate deployables that must agree exactly."_ The recovery repo's own already-landed code
  expects this app to exist.
- `SPRINT_8_RUNTIME_PLATFORM_REPORT.md` independently corroborates: "`apps/collector` is a third,
  independent Fastify app" alongside Admin/Runtime/Storefront.

**Confidence: High** — multiple independent primary sources agree on existence, scope, and
ownership; this is a materially stronger evidence base than the Integration Sprint exception.

## Dependencies — fully satisfied by already-committed packages

Every `@platform/*` package `apps/collector` imports (`clock`, `config`, `domain-events`, `health`,
`id`, `kafka`, `messaging`, `tracking`, `utils`) already exists in this repo. Every specific symbol
it needs from `@platform/tracking` — `collect`, `PERMANENT_COLLECTOR_REFUSALS`,
`TRACKING_CAPTURED_TOPIC`, `TRACKING_CAPTURED_VERSION`, `CollectorDeps`, `CollectorRefusal`,
`CollectorRequest`, `CookieDirective`, `TrackingCapturedEventPayload`, `WriteKeyResolverPort`,
`parseCookieHeader` — is exported by the K7-partial barrel (`c24ec9b`); none of it touches the
still-deferred `definitions`/`execution` cluster. No reverse dependency exists (nothing yet
committed imports `apps/collector`).

## Note (not this milestone's scope, not fixed)

`docs/implementation/P5_M6_TRACKING_RUNTIME_COMPLETION_REPORT.md`'s own §14 flags `apps/collector`
as "not dependency-cruised" (`pnpm arch` only scans `packages`/`services`, not `apps` — confirmed:
this repo's `.dependency-cruiser.cjs` invocation is `depcruise packages services`). This is a
pre-existing, documented gap in the source repo itself, not something this milestone introduces or
is scoped to fix — noted here for the Final Operational Readiness Sprint's own audit.

## Verification

`pnpm --filter @platform/collector typecheck/test/lint`: green (13/13 tests). `pnpm arch`: 0
violations (apps/ is out of its scope by design, unaffected). Full monorepo `pnpm typecheck`: 74/76
— the one failure (`apps/admin`) is the pre-existing, already-documented app-composition-wiring gap
(`INTEGRATION_SPRINT_APP_WIRING_STATUS.md`), not a regression from this milestone.
