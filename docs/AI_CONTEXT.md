# AI_CONTEXT — read me first (3-minute onboarding)

> Single source of architectural memory for any AI session (Claude, GPT, or future model).
> If anything here conflicts with the code, the code + [`architecture/`](architecture/README.md)
> contract win — update this file. Companion files: [PROJECT_STATE.md](PROJECT_STATE.md) ·
> [DECISIONS.md](DECISIONS.md) · [MASTER_PROMPT.md](MASTER_PROMPT.md) ·
> [DEVELOPMENT_PROCESS.md](DEVELOPMENT_PROCESS.md).

## Project vision

**Morbeh** — an enterprise, AI-native commerce platform for **premium educational toys (ages 0–10)**.
It must outperform Shopify on **CRO experimentation, marketing attribution, first-party analytics,
and customization**. Built incrementally at senior-architecture quality; **quality over speed**.

## Architecture summary

- **Modular monolith first**, extract to services only on measured need (Strangler Fig; [ADR-0001](architecture/adr/0001-modular-monolith-with-strangler-extraction.md)).
- **DDD** bounded contexts; **one PostgreSQL schema per context**; **no cross-context FKs/joins**.
- **Clean Architecture** — dependencies point **inward**:
  `kernel → domain → application → infrastructure → presentation`.
- **Event-driven** via transactional outbox + CDC (Redpanda) — _not built yet_.
- **First-party data**, **privacy/child-safety by design** (COPPA/GDPR-K), **API-first**,
  **everything-as-config** (flags/experiments/feeds), **observability + security by default**.
- Full contract: [`docs/architecture/`](architecture/README.md) (01–21 + ADRs). Build sequence:
  [`implementation/IMPLEMENTATION_ROADMAP.md`](implementation/IMPLEMENTATION_ROADMAP.md).

## Current package structure (Turborepo + pnpm; scope `@platform/*`)

| Layer                                                     | Packages                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kernel** (framework-free; any layer may use)            | `types` (Result/Either + Brand), `utils` (logger, AppError + DomainError hierarchy + error envelope)                                                                                                                                                                                                                                                                                                   |
| **Domain** (pure; kernel only)                            | `domain` (Entity, AggregateRoot, ValueObject, UniqueEntityId, DomainEvent, Guard, Specification, DomainService; shared VOs `Money` + `ProductRef` — promoted at rule of three, D-030)                                                                                                                                                                                                                  |
| **Contracts** (outbound port interfaces; no runtime deps) | `contracts` (`IdGenerator`, `Clock`; `Principal`/`Authenticator`/`Permission`/`AccessControl`), `repository` (persistence ports), `domain-events` (integration-event envelope + topic/versioning + `EventSerializer`), `feature-flags` (`FeatureFlags` + `InMemoryFeatureFlags`)                                                                                                                       |
| **Application** (no infra deps)                           | `application` (DI, CQRS buses, UseCase, middleware; owns the `ID_GENERATOR`/`CLOCK` DI tokens), `config` (typed env + server config + flags), `tracking` (event-envelope types)                                                                                                                                                                                                                        |
| **Messaging** (event backbone; above application)         | `messaging` (transactional outbox write-side, `EventPublisher`/`EventConsumer`, idempotency, retry, DLQ; in-memory adapters — broker/Debezium/Avro deferred)                                                                                                                                                                                                                                           |
| **Infrastructure** (adapters)                             | `db` (Prisma + repo adapter), `redis`, `clickhouse`, `storage` (S3/MinIO), `secrets`, `observability` (OTel), `health`, `id` (`CryptoIdGenerator` → UUIDv7), `clock` (`SystemClock`)                                                                                                                                                                                                                   |
| **UI + build config**                                     | `ui` (shadcn), `design` (frozen tokens), `eslint-config`, `tsconfig`, `prettier-config`                                                                                                                                                                                                                                                                                                                |
| **Apps / Services**                                       | `apps/storefront` (Next.js shell), `apps/admin-web` (Next.js admin surface — the **Morbeh Dashboard**), `apps/admin` (`@platform/admin` — framework-agnostic admin wiring facades → 5 contexts), `services/example` (walking-skeleton reference — non-business), `services/{catalog,media,pricing,inventory,cart,orders,payments,checkout,identity}` (Phase 1 contexts — all 9; in-memory persistence) |

Per-package responsibilities: [`development/WORKSPACE_GUIDE.md`](development/WORKSPACE_GUIDE.md).

## Dependency rules (enforced in CI via `pnpm arch` — dependency-cruiser)

- Packages never import from `apps/`. Apps/services import packages, never each other's internals.
- **Domain** depends only on the kernel. **Application** never imports infrastructure (uses ports + DI).
  **Outbound ports** are interfaces in leaf packages (`contracts`, `repository`); **Infrastructure**
  adapters implement them depending only on those packages (e.g. `db`→`repository`, `id`/`clock`→`contracts`),
  never on `application`. DI tokens live in `application`. Dependencies point inward ([ADR-0002](architecture/adr/0002-outbound-ports-in-contracts-package.md)).
- Cross-package imports use the public entry only (`@platform/<pkg>`), never deep `src` paths.

## Sprint status

- ✅ **0.1** monorepo · ✅ **0.2** infrastructure · ✅ **0.3** application layer · ✅ **0.4** domain foundation + ID/Clock abstractions (all validated: lint/typecheck/test/build green).
- **0.4 review findings resolved (2026-06-29):** M1 `@platform/contracts` (port interfaces, [ADR-0002](architecture/adr/0002-outbound-ports-in-contracts-package.md)) · M2 UUIDv7 · M3 `Clock` + `@platform/clock` · M4 deep-frozen value objects · M5 `UniqueEntityId` non-empty invariant · L1 `pullDomainEvents()`. See DECISIONS D-018–D-022.
- **0.5 (design only, 2026-06-29):** Phase 1 (Commerce Core) business-layer design — YAGNI-scoped to 9 contexts (catalog, media, pricing, inventory, cart, checkout, orders, payments, identity); conforms to the contract, no ADR. Spec: [SPRINT_0_5_PHASE1_DESIGN.md](implementation/SPRINT_0_5_PHASE1_DESIGN.md).
- ✅ **0.6 event backbone (2026-06-30):** `@platform/domain-events` (integration-event contracts) + `@platform/messaging` (outbox write-side, publisher/consumer, idempotency, retry, DLQ; in-memory adapters). Classic outbox, no CQRS/ES; `domain ← application ← messaging ← infrastructure`. Broker/Debezium/Avro adapters deferred. See DECISIONS D-023/D-024, [SPRINT_0_6_REPORT.md](implementation/SPRINT_0_6_REPORT.md).
- ✅ **0.7 auth/flags seams (2026-06-30):** auth/authz **ports** added to `@platform/contracts` (`Principal`/`Authenticator` → `Principal | null`; `Permission`/`AccessControl` → `boolean`); `AuthenticationError`/`AuthorizationError` added to `@platform/utils`; new `@platform/feature-flags` (`FeatureFlags` + `InMemoryFeatureFlags`, minimal). No `@platform/security`, no audit, no DI tokens, no rollout engine — all deferred. See DECISIONS D-025, [SPRINT_0_7_REPORT.md](implementation/SPRINT_0_7_REPORT.md).
- ✅ **0.8 fitness functions + walking skeleton (2026-06-30):** `dependency-cruiser` + `pnpm arch` (CI gate) enforce dependency direction, the deep-import ban (`@platform/<pkg>`, never `/src/*`), and no-cycles; `turbo gen` generators (package/service/aggregate/use-case); `services/example` proves API→application→domain→repository→outbox→messaging in-process. **Phase 0 plumbing complete.** See [SPRINT_0_8_REPORT.md](implementation/SPRINT_0_8_REPORT.md).
- ✅ **1.1 Commerce Core: Catalog + Media (2026-06-30):** `services/catalog` (Product/Variant/Category; `product.published`/`product.updated`) + `services/media` (Asset; `media.asset_ready`). Independent Clean-Architecture slices on the kernel/messaging; in-memory persistence + outbox (Prisma/broker deferred); no cross-context imports (`MediaRef` by id); framework-agnostic controllers + `present()`. VO factories return `Result`, aggregate invariants throw `DomainError`→Result; `Money`/`Slug` context-local pending rule-of-three. See DECISIONS D-026, [SPRINT_1_1_REPORT.md](implementation/SPRINT_1_1_REPORT.md).
- ✅ **1.2 Commerce Core: Pricing + Inventory (2026-06-30):** `services/pricing` (Price/PriceList; `price.changed`) + `services/inventory` (InventoryItem/Reservation; single `inventory.adjusted` event with a reason). Same slice pattern; in-memory persistence + outbox; refs by bare id (`ProductRef`). `Money` now in 2 contexts — still context-local (rule of three). See DECISIONS D-027, [SPRINT_1_2_REPORT.md](implementation/SPRINT_1_2_REPORT.md).
- ✅ **1.3 Commerce Core: Cart (2026-06-30):** `services/cart` (Cart aggregate + CartItem entity; lifecycle events `cart.checked_out` + `cart.abandoned`). Same slice pattern; in-memory persistence + outbox; products by bare id with a **caller-supplied unit-price snapshot** (no Pricing/Inventory import); `cart.checked_out` is the Sprint 1.4 checkout-saga trigger. **Rule of three now reached for `Money` (3 contexts) + `ProductRef` (3) — promotion deferred to a dedicated refactor** (would touch committed contexts). See DECISIONS D-028, [SPRINT_1_3_REPORT.md](implementation/SPRINT_1_3_REPORT.md).
- ✅ **1.4 Commerce Core: Checkout + Orders + Payments (2026-06-30):** **Step 0** promoted `Money`+`ProductRef` into `@platform/domain` (rule of three; 6 local copies deleted, all contexts migrated — canonical `Money` is string-currency, non-negative, with `plus`/`minus`/`times`/comparisons; DECISIONS **D-030**). Then `services/orders` (Order + OrderItem/OrderEvent; status derived from an append-only history; `RefundPolicy` domain service; snapshots not live refs; `order.{placed,paid,refunded}`), `services/payments` (PaymentIntent + Charge/Refund; `payment.{captured,failed,refunded}`), `services/checkout` (CheckoutSession; `checkout.{completed,failed}`). Same slice pattern; in-memory + outbox; no cross-context imports. **The purchase-saga orchestration (Checkout driving the other contexts) is deferred** — needs Temporal + gRPC clients. See DECISIONS **D-031**, [SPRINT_1_4_REPORT.md](implementation/SPRINT_1_4_REPORT.md).
- ✅ **1.5 Commerce Core: Identity (2026-06-30):** `services/identity` (Customer aggregate + Address/ConsentRecord append-only entities; `Email`/`ConsentScope` VOs; `customer.registered`+`consent.changed`). Email is the natural key — `RegisterCustomer` enforces uniqueness (`ConflictError`); consent is derived from the append-only log. Same slice pattern; in-memory + outbox; no cross-context imports. Auth deferred (ports already in `@platform/contracts`); households/child-profiles/ReBAC out (YAGNI). **Phase-1 business contexts complete (9/9).** See DECISIONS **D-032**, [SPRINT_1_5_REPORT.md](implementation/SPRINT_1_5_REPORT.md).
- ✅ **1.6 Admin wiring (2026-06-30) — Phase 1 COMPLETE:** `apps/admin` (`@platform/admin`) — framework-agnostic facade controllers binding the 6 frozen Phase-1 admin screens (Products/Inventory/Orders/Customers/Discounts/Coupons) to Catalog/Inventory/Orders/Identity/Pricing. Pure delegation (`Parameters<Controller["method"]>` pass-through → each context's `ControllerResponse`); no business/UI change; presentation owned by the context presenters. Lives in `apps/` because the `no-cross-service-internals` fitness rule bars a _service_ from importing other services — `apps/` is the composition seam (arch 0 violations). No HTTP server (transport adapter + admin cross-cutting baseline deferred). See DECISIONS **D-033**, [SPRINT_1_6_REPORT.md](implementation/SPRINT_1_6_REPORT.md).
- **Next:** Phase 2 (not authorized) — requires real infra (Docker host): commit the uncommitted Phase-1 work, then Prisma/Postgres + Redis + S3, Redpanda/Debezium broker, the Temporal purchase saga + gRPC clients, HTTP transport, and the admin cross-cutting baseline. See [PROJECT_STATE.md](PROJECT_STATE.md) "Next: Phase 2".

## Important conventions & coding standards

- **Strict TypeScript** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`); `type` imports; **no `any`/`@ts-ignore`/`eslint-disable`**.
- Prettier: 2-space, **double quotes**, width 100, semicolons, trailing commas. ESLint 9 flat config.
- Errors via `@platform/utils` (`AppError`/`DomainError`); `Result` for expected failures, exceptions for unexpected. Logging via `@platform/utils` logger (no raw `console.log`).
- Conventional Commits (commitlint). Full standards: [`development/CODING_STANDARDS.md`](development/CODING_STANDARDS.md).
- **Env gotchas:** pnpm **11.9.0** (Corepack); installs need `CI=true`, `--no-frozen-lockfile` when deps change; pnpm-11 `minimumReleaseAge` supply-chain policy; approved build scripts allowlisted in `pnpm-workspace.yaml` (`allowBuilds`).

## Things AI must **NEVER** change (without explicit approval / an ADR)

1. The **Morbeh Design System** — [`docs/ui/`](ui/README.md) is the visual source of truth and the platform's only design system; build from `@platform/ui` on `@platform/design` tokens, never hard-code visual values, never start a parallel system.
2. **Completed sprints (0.1–0.4)** — treat as production; no unrelated refactoring.
3. The **architecture contract** ([`architecture/`](architecture/README.md)) — change only via an [ADR](architecture/adr/).
4. **Dependency direction & layer boundaries** (domain pure; application ↛ infrastructure).
5. **Homes of shared concepts** — `Result`→`types`, errors→`utils`, persistence ports→`repository`, other outbound ports→`contracts` (DI tokens→`application`), CQRS→`application`. Never create parallel implementations.
6. **Identifiers:** package scope stays `@platform/*`; project root folder is `morbeh-platform`.
7. **Toolchain pins:** `packageManager` (pnpm 11.9.0), the lockfile, and `allowBuilds`.

## Things AI **is allowed** to extend

- Add new packages that respect the layering; add bounded-context domain/app packages per the architecture.
- Extend the kernel **additively** (new helpers/errors) without breaking existing exports.
- Add infrastructure **adapters** that implement existing ports.
- Add tests and documentation.
- Implement the next approved sprint exactly as specified — nothing more.

## Sprint 2.2 addendum (2026-07-05)

Production persistence exists: per-context Prisma repositories + mappers (see D-042 for the mandatory adapter shape) and @platform/db messaging adapters. In-memory adapters remain the TEST wiring; never point tests at Prisma without DATABASE_URL_TEST. Aggregates rehydrate ONLY via
econstitute (never raises events). Integration execution is blocked on a Docker host — see SPRINT_2_2_REPORT.md.

## Sprint 2.2.5 addendum (2026-07-05)

The full infrastructure stack exists at `infrastructure/docker/docker-compose.yml` (17 services; topology contract doc 26; ops runbook infrastructure/docker/README.md; conventions D-043). Docker CLI/Compose are installed on this machine but the ENGINE was not running — `docker compose config` validates; `up` + first-boot runbook (migrate deploy → publication add → connector register → gated integration tests) is the operator''s next step. Never fake integration results.

## Sprint 2.3 addendum (2026-07-05)

Redis ports live in @platform/contracts (Cache/DistributedLock/RateLimiter/IdempotencyKeyStore, D-044); adapters in @platform/redis. Locks are NEVER a correctness guard. Caches hold mapper row DTOs only; writes delete cache entries; transactional reads bypass caches. Cart: `CachedCartRepository` decorates the durable repo — Postgres remains the source of truth.

## Sprint 2.4 addendum (2026-07-05)

Storage ports live in @platform/contracts (D-045): keys come ONLY from `StorageKeyFactory` (immutable, tenant-prefixed; new version = new key); uploads validate against allowlist `UploadPolicy` BEFORE bytes move; `S3ObjectStorage` is the MinIO/S3/R2 adapter (put refuses overwrite). FileScanner/ImageTransformer are seams only — do not implement without their consuming surface.

## Sprint 2.5 addendum (2026-07-05)

Broker runtime = @platform/kafka (D-046). Consumer groups use `KafkaConsumerRuntime` (retry topics, never in-process sleep); producers pass outbox bytes through verbatim; cross-context consumers live in the consuming context''s interfaces/ and call use cases only (see orders'' payment-captured consumer for the reference semantics: already-paid = success, not-found = retry, anomaly = DLQ).

## Sprint 2.6 addendum (2026-07-05)

Transport = @platform/http + @platform/grpc (D-047). New endpoints are `defineRoute` definitions (zod + permission + version) delegating to controllers — never import Fastify in routes, never bypass use cases, never run tenant-less. AdminGuard is injected as the transport guard (one policy engine). OpenAPI derives from the validating zod schemas. Transport tests use `fastify.inject` — they are NOT Docker-gated.

## Sprint 2.7 addendum (2026-07-05)

Identity adapters = @platform/auth (D-048): `JwtVerifier`/`KratosSessionAuthenticator` behind `Authenticator`/`ClaimsAuthenticator`; `KetoAccessControl` (+`CachedAccessControl`) behind `AccessControl` — swap `AllowAllAccessControl` at the composition root only. Never import an Ory SDK; never code self-service flows (Kratos config); authorization always fails closed. JWT-claim tenant resolution is live in the transport.

## Sprint 2.8 addendum (2026-07-05)

Saga = @platform/temporal (ADR-0012, D-049): edit orchestration in the deterministic core (`saga/purchase-saga.ts` — NEVER add clock/ids/IO there); the workflow file only adapts signals/timers/retries. Payment capture reaches the saga as a signal from the webhook event — never call the PSP for truth. PSP adapters implement the contracts `PaymentProvider` port, raw REST only. ADR-0011 (metafields) and ADR-0013 (reservation ledger) are frozen designs awaiting their implementation sprints.

## Sprint 2.9 addendum (2026-07-05)

Runtime = apps/runtime (D-050): config.ts is the ONLY process.env reader; buildRuntimeCore wires everything lazily (never connect in composition); entrypoints api/worker/scheduler own connect/start/shutdown. No fake identity (JWKS required); fail closed without Keto outside local. Open composition gaps are G-39 (production context wiring for the facade) and G-40 (session ref on payment events → signal bridge).

## Sprint 3.0A addendum (2026-07-05) — memory system complete + consolidated orientation

The engineering-memory file set is now complete and its update contract is codified (D-051):
this file + PROJECT_STATE + DECISIONS + MASTER_PROMPT + DEVELOPMENT_PROCESS (existing since
Phase 0) plus ARCHITECTURE_OVERVIEW (Mermaid views), CHANGELOG_AI (sprint index), KNOWN_GAPS
(open-gap mirror; doc 23 stays master), RELEASE_PROCESS (pipeline; CI real, rest designed).

**Orientation snapshot (as of Sprint 3.0A):** 9 commerce contexts (DDD/Clean, in-memory + Prisma
persistence adapters) · kernel + 20 platform packages incl. db/redis/kafka/storage/auth/http/
grpc/temporal · apps: admin (facade + HTTP API), runtime (api/worker/scheduler), storefront
(walking skeleton) · infrastructure: 17-service compose (doc 26) · ADR-0001…0013 frozen ·
current gates 121/121 + arch 0 violations · **everything uncommitted (G-0)** · next: Sprint 3.0B
First Boot (G-41) → G-39/G-40 → read side (G-8). Canonical details: architecture/ docs 01–26,
DECISIONS D-001…D-051, KNOWN_GAPS.

## Sprint 3.0B addendum (2026-07-05)

First Boot attempted and BLOCKED at step 1: Docker Desktop requires one interactive GUI start on this machine (headless launch non-resident; service ACL-denied; WSL2 fine). Do NOT re-attempt headless — ask the operator to start Docker Desktop once, then execute SPRINT_3_0B_REPORT ''Operator unblock runbook'' and re-run 3.0B. Tracking/website/notification verifications are unbuilt future phases — never claim them.

## Sprint 3.0B retry addendum (2026-07-05)

Attempt #2: engine verified UP, then CRASHED during the first `compose up` pull batch; headless relaunches non-resident. Blocker is engine STABILITY (likely WSL RAM). Follow SPRINT_3_0B_REPORT ''Retry attempt #2'' runbook: wsl --shutdown → GUI start → raise WSL resources → `docker compose pull` first → batched `up -d` → re-run 3.0B.

## Sprint 3.0C addendum (2026-07-05)

Baseline committed as ONE honest commit (sprint-3.0C-baseline tag) — per-sprint history for 1.3–3.0B lives in the sprint reports, NOT in git (retro-separation would have fabricated states). From now on: one commit per sprint, tagged `sprint-<n>` (D-051/RELEASE_PROCESS). Operator''s next action: push main+tags to GitHub. Local bundle backup exists outside the repo.

## Sprint 3.1 addendum (2026-07-05)

Docker diagnosis is now evidence-complete (SPRINT_3_1_REPORT): the backend DID run and start our containers once, then died mid-startup (likely WSL resources); headless launches never spawn the backend. Do not attempt headless starts again — require the operator''s interactive start + raised WSL resources, then follow the 3.0B Retry-#2 runbook.
