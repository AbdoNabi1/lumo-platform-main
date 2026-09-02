# Sprint 2.3 Report — Redis Layer (cart hot layer, locks, rate limiting, idempotency)

> 2026-07-05. Scope per the Phase-2 plan (step 3) and doc 26 §1. No domain/aggregate/event
> changes; Postgres remains the cart source of truth (D-042) — Redis fronts it.

## Delivered

**Ports (`@platform/contracts`, per D-018):** `Cache` (promoted from `@platform/redis`, ending
the Sprint-0.2 placement inconsistency; type re-exported for back-compat), `DistributedLock` +
`LockHandle` (efficiency-only contract — correctness stays with optimistic locking/idempotency),
`RateLimiter` (throws on infra failure; enforcement point chooses fail-open/fail-closed — the
G-3/G-38 seam), `IdempotencyKeyStore` (client-request `Idempotency-Key` claims — distinct from
`ProcessedEventStore`, which remains Postgres-in-handler-tx per ADR-0005).

**Adapters (`@platform/redis`):** `RedisDistributedLock` (SET NX PX + random token; Lua-guarded
release/extend — a stale holder can never free a successor's lock), `RedisRateLimiter` (atomic
fixed-window Lua: INCR + first-hit PEXPIRE + PTTL in one round trip), `RedisIdempotencyKeyStore`
(SET NX EX + token-guarded release for failed executions; successes expire by TTL).

**Cart hot layer (`services/cart`):** `CachedCartRepository` — a `CartRepository` decorator:
read-through populate, **delete-on-write** (a delete under transaction rollback costs one miss;
a write could lie forever), **transactional reads bypass the cache** (read-your-writes),
cached values are **mapper row DTOs rehydrated via `CartMapper.toDomain`** (domain invariants
re-established on every cache hit; corrupt entries fail loudly), tenant-prefixed keys
(`tenant:<id>:cart:<id>`, ADR-0008), cache-read failures degrade to the source of truth while
invalidation failures propagate (stale ≠ degraded).

**Tests:** 5 fully-green unit tests for the decorator (read-through, invalidation, tx bypass,
degradation, tenant keying) with inline fakes; Redis adapter integration suite **honestly gated
on `REDIS_URL_TEST`** (engine not running on this machine — first-boot runbook applies).

## Why / tradeoffs / alternatives rejected (D-044)

- **Fixed-window rate limiting** — up to 2× edge burst accepted for O(1) memory and one round
  trip; a sliding-window Lua adapter can replace it behind the same port. _Rejected:_ sliding
  log (memory per request), token bucket (more state, same port shape later if needed).
- **Single-instance lock, no Redlock** — Redlock's safety under partition is contested and
  fencing tokens don't exist on Redis; the port contract forbids using locks for correctness,
  which removes the need. _Rejected:_ multi-node Redlock (complexity buying contested safety).
- **Delete-on-write cache** — vs write-through (stale-on-rollback risk under the ADR-0003 tx
  seam) and vs TTL-only (unbounded staleness window on live carts).
- **Row-DTO caching** — vs serialized aggregates (classes don't JSON-round-trip; would bypass
  invariant re-establishment) and vs response caching (belongs to the transport layer, G-30).

## Long-term cost

One more port family to maintain (4 small interfaces); the decorator adds a read path to reason
about — bounded by the three correctness rules written on the class. Redis Cluster migration is
config-level (ioredis), with the known caveat that multi-key Lua stays single-key here (all
scripts are 1-key — cluster-safe).

## Validation

lint / typecheck / test / build **103/103** ✅ · dependency-cruiser **0 violations (400
modules)** ✅ · Redis integration suite ⛔ gated on `REDIS_URL_TEST` (engine down — never faked).

## Deferred

Enforcement points (transport middleware) for RateLimiter/IdempotencyKeyStore — Sprint 2.6
(transport); response-replay via Cache keyed by idempotency key — with the transport; sliding
window — on measured need; cart-cache metrics — with app instrumentation (G-19).
