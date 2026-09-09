# Sprint 2.6 Report — Transport Layer (HTTP + gRPC)

> 2026-07-05. Scope per Phase-2 step 6. No ADR violated; application layer never bypassed;
> repositories never touched from transport; dependency rules unchanged (kafka/http/grpc all
> inside the fitness functions' world).

## Delivered

**`@platform/http` (Fastify as infrastructure only):**

- `RouteDefinition`/`defineRoute` — framework-independent routes: zod schemas + permission +
  version + handler receiving PARSED input + `RequestContext` (tenantId, principal, requestId,
  correlationId) and returning the same transport-neutral shape the existing controllers emit.
  Routes are pure delegation by construction.
- `createHttpServer`/`registerRoutes` — the pipeline, every concern an injected port:
  requestId + correlation propagation (`x-request-id`/`x-correlation-id`/`traceparent` echo) →
  **authentication seam** (`Authenticator` port; Ory adapter is G-1, fakes in tests) →
  **tenant-resolution-first** (ADR-0008: resolver chain header/claim/domain/custom; no
  application code runs tenant-less; no default tenant) → **authorization through ONE policy
  engine** (`PermissionGuard` is the structural twin of `AdminGuard` — injected because packages
  never import apps; zero duplicate policy code) → **rate limiting** (Sprint-2.3 `RateLimiter`
  port, per-(tenant, principal) buckets, fail-closed on this surface, 429 + retryAfterMs) →
  **zod boundary validation** (422 with field issues; domain validation stays in the domain) →
  **idempotency** (Sprint-2.3 `IdempotencyKeyStore` claim + `Cache` response replay for
  POST/PUT/PATCH; failed executions release the claim) → handler → **uniform error mapping**
  (VALIDATION 422 / NOT_FOUND 404 / CONFLICT+CONCURRENCY+BUSINESS_RULE 409 / UNAUTHENTICATED
  401 / FORBIDDEN 403 / RATE_LIMITED 429 / unknown 500, never leaking internals).
- Operational endpoints: `/healthz` (liveness), `/readyz` (`HealthRegistry` → 503 on unhealthy),
  `/metrics` (real process metrics in Prometheus text; runtime metrics ride G-19), `/docs` +
  `/openapi.json` — **generated from the same zod schemas that validate**, so spec and
  enforcement cannot drift. Versioned routing under `/api/v<n>`.

**`@platform/grpc`:** versioned proto contracts (`morbeh.orders.v1` — Place/MarkPaid/Refund,
tenant-scoped messages), runtime loading via proto-loader (no manual serialization; buf codegen
replaces the loader for clients when `@platform/api-clients` lands, G-18), server factory with
the interceptor seam, insecure creds only inside the mesh (mTLS per doc 14 §5).

**Admin API exposed (`apps/admin/src/http/`):** `createAdminHttpApi` composes the Phase-1 admin
facade behind the transport — `AdminGuard` injected as the guard (audited authorization on every
route), three v1 routes (create product, place order, refund) with zod bodies; `PlaceOrder`
stays an internal/admin operation per the doc-22 pricing rule (noted in code).

## Testing — NOT gated, genuinely green

Fastify's `inject()` runs the full pipeline in-process: **13 new tests pass with no Docker** —
401/403/tenant-less/guard-deny/429/422-with-fields/happy-path/idempotent-replay(handler runs
once)/health/ready/metrics/OpenAPI-shape, plus the admin end-to-end (transport → facade → use
case → domain → presenter, with audit-trail assertions) and gRPC contract loading. Honestly
gated remains only what needs live services: Ory verification, Redis-backed limiter/idempotency
(covered by Sprint-2.3's gated suite), and socket-level gRPC calls.

## Decisions (D-047) / tradeoffs

Fastify over Express/Hono (schema-first, fastest mainstream, still 100% behind our route
abstraction — swappable); zod as the single boundary validator (ajv bypassed for parsing
fidelity; OpenAPI derived from zod so one source of truth); **G-22 resolved**: transport routes
delegate directly to the framework-agnostic controllers — the CQRS bus stays formally parked
(its middleware pipeline added no value over the explicit pipeline above; revisit only if
cross-cutting per-use-case middleware materializes); runtime proto loading now, static codegen
with G-18; process-level `/metrics` now, runtime histograms with G-19.

## Deferred

Ory adapters (G-1/G-2) behind the existing seams · claims-based tenant resolver activation
(wired, null until the JWT adapter) · worker entrypoint (supervisor + consumers + this server
in one process) · OpenAPI snapshot file committed per release (snapshot test asserts shape
today) · gRPC socket integration tests (gated with the runtime).

## Validation

lint / typecheck / test / build **112/112** ✅ (13 new transport tests green) ·
dependency-cruiser **0 violations (434 modules)** ✅ · nothing faked; no runtime claims made.
