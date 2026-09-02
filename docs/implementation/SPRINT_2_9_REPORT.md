# Sprint 2.9 Report — Runtime Composition

> 2026-07-05. Composition ONLY: no new domain rules, no new ports, no new abstractions.
> Deliverable: `apps/runtime` (`@platform/runtime`) — three entrypoints over one composition root.

## Runtime architecture

**`config.ts`** — the ONLY `process.env` reader (zod-typed: db/redis/kafka/temporal/ory/tenant/
rate-limit/retention groups; field-named startup errors).

**`composition.ts` (`buildRuntimeCore`)** — every dependency wired from the root, all clients
lazy (graph construction is side-effect-free ⇒ testable without Docker): Prisma, Redis handle
(cache/lock/rate-limiter/idempotency), Kafka client, JSON envelope serializer (Apicurio replaces
it behind the same contract later), `JwtVerifier` (JWKS **required** — no fake identity, D-048),
Keto + decision cache with the secure default: **no Keto outside `local` = composition fails
closed**; health registry (postgres SELECT 1 + redis PING; the worker adds consumer health).

**`api.ts`** — the admin surface behind the full production pipeline (authn → tenant-first →
authz → rate limit → idempotency → validation), health/ready/metrics/OpenAPI, graceful
shutdown. gRPC binds when its first internal caller exists (G-18) — a port with zero callers is
decoration. **Named gap G-39:** the admin facade still composes the Phase-1 IN-MEMORY context
slices; per-context production wiring (Prisma-backed `wireOrders` etc.) is the next composition
seam — recorded, not hidden.

**`worker.ts`** — `ConsumerSupervisor` + the first production consumer: `payments.
payment_intent.captured` → `MarkOrderPaid` over the full Prisma slice (tx-scoped outbox,
Postgres inbox, retry topics, DLQ topic+row), consumer health in the readiness registry. The
Temporal worker joins when its activities become composable — honestly blocked on: a price-quote
use case (G-8), the ADR-0013 commit implementation, and payments carrying the checkout-session
ref for the signal bridge (**named gap G-40**, ADR-0012 follow-up). Registering a worker whose
activities cannot exist would be a fake adapter.

**`scheduler.ts`** — injected-job interval runner: single-flight via the Redis distributed lock
(idle instances skip), failures logged + retried next tick, jobs idempotent by contract. First
real job: outbox pruning (the outbox is a queue, not an event store). Reservation expiry joins
with ADR-0013; Temporal Schedules replace the loop on the k8s host (doc 26 §7).

## Validation

lint / typecheck / test / build **121/121** ✅ · dependency-cruiser **0 violations (449
modules)** ✅ · **9 new composition tests genuinely green offline**: typed config +
field-named failures; side-effect-free core graph; JWKS-required; **fail-closed-without-Keto**;
the full worker consumer graph (topic/group assertions, built-not-started); health registry
contents (and honestly `unhealthy` on this machine — nothing is running); scheduler job registry

- lock-respected single-flight. Live process start remains Docker-gated (first-boot runbook).

## Deferred (all named in the gap register)

G-39 production context composition (facade persistence wiring) · G-40 payments carries
checkout-session ref → signal bridge + Temporal worker registration · Ory/Temporal compose
containers + first live boot · OTel exporters (G-19) · gRPC binding with api-clients (G-18).
