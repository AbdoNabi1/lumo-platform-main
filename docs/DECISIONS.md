# DECISIONS — architecture decision log

> Every significant decision, with its reason and trade-offs. **Never redesign a decision without
> explicit approval + a new ADR** (`architecture/adr/`). Newest ADRs win; this log mirrors them in
> brief. Format: Decision · Reason · Trade-offs.

### D-001 — Modular monolith first, extract by Strangler Fig

- **Decision:** Build the transactional core as one deployable with strict module boundaries; run only high-throughput capabilities as separate services; extract others on measured need. ([ADR-0001](architecture/adr/0001-modular-monolith-with-strangler-extraction.md))
- **Reason:** Avoid premature distribution cost; keep velocity; preserve a clean extraction path.
- **Trade-offs:** Requires discipline to keep boundaries; some intentional duplication (e.g. order-time product snapshots).

### D-002 — DDD bounded contexts; one DB schema per context; no cross-context FKs/joins

- **Decision:** Each context owns its data; cross-context references are bare ids; integrity via the owning service + events.
- **Reason:** Makes extraction mechanical; enforces independence.
- **Trade-offs:** No DB-level cross-context integrity; more application-level coordination.

### D-003 — Clean Architecture; dependencies point inward

- **Decision:** `kernel → domain → application → infrastructure → presentation`. Inner layers never import outer.
- **Reason:** Testability, replaceable infrastructure, longevity.
- **Trade-offs:** More interfaces/indirection; ports + adapters overhead.

### D-004 — `Result`/`Either` live in `@platform/types`

- **Decision:** One `Result<T,E>` type + helpers (`ok`/`err`/`map`/`match`/…) in the kernel.
- **Reason:** Usable by every layer without coupling; single source.
- **Trade-offs:** Kernel `types` gains a small runtime surface (acceptable).

### D-005 — Error hierarchy lives in `@platform/utils` (kernel)

- **Decision:** `AppError` + `DomainError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `ConcurrencyError`, `BusinessRuleError`, `UnexpectedError`) + `toErrorEnvelope` in utils.
- **Reason:** The domain layer can use errors without depending on the application layer.
- **Trade-offs:** "Domain"-named errors sit in a kernel package (documented; single error home).

### D-006 — Repository ports in `@platform/repository`; adapters in infrastructure

- **Decision:** Interfaces (`Repository`, `ReadRepository`, `WriteRepository`, `UnitOfWork`, `TransactionalUnitOfWork`) in `repository`; the Prisma adapter foundation in `@platform/db`.
- **Reason:** Dependency Inversion — application depends on ports, never on Prisma.
- **Trade-offs:** Extra port package; adapter wiring via DI.

### D-007 — CQRS lives only in the Application layer

- **Decision:** Command/query buses, handlers, use-cases, middleware in `@platform/application`. Domain has none of it.
- **Reason:** CQRS is an orchestration concern, not a domain concern.
- **Trade-offs:** Buses are type-erased internally (handled with localized, sound casts).

### D-008 — Domain is pure and deterministic

- **Decision:** No id generation, no clock reads, no infrastructure/framework/messaging/HTTP/DB in `@platform/domain`. Depends only on the kernel.
- **Reason:** Reusable by every bounded context; fully unit-testable; no hidden side effects.
- **Trade-offs:** Ids/timestamps must be supplied from outside (more explicit construction).

### D-009 — ID generation through abstraction (Dependency Inversion)

- **Decision:** Domain exposes only `UniqueEntityId` + `UniqueEntityId.from(value)`. The `IdGenerator` **port interface** lives in `@platform/contracts` (D-018); its `ID_GENERATOR` DI token lives in `@platform/application`; the `CryptoIdGenerator` **adapter** lives in infra `@platform/id` (UUIDv7, D-022). The application generates ids and passes them in; repositories rehydrate via `from()`.
- **Reason:** Keeps the domain deterministic and infrastructure-independent.
- **Trade-offs:** Infra adapter + DI wiring; aggregates can't self-mint ids.

### D-010 — Domain events are infrastructure-free

- **Decision:** `DomainEvent` carries supplied `eventId`/`aggregateId`/`occurredAt`; `AggregateRoot` only collects events. No bus, outbox, or publishing in the domain.
- **Reason:** Determinism + keeps messaging an infrastructure concern.
- **Trade-offs:** Event id/time supplied externally; dispatch wired later (outbox).

### D-011 — Frozen UI contract

> **SUPERSEDED by [D-052](#d-052--morbeh-design-system-is-the-canonical-design-system) (2026-08-08).** The frozen prototype, its five `docs/ui/` specifications, and its tokens have been retired and removed. Retained here as history — this contract no longer binds.

- **Decision:** `docs/ui/` (+ `apps/admin/prototype/admin-dashboard.frozen.html`) is the visual source of truth. Extend functionality only; never redesign; new surfaces require approval.
- **Reason:** Stable, approved UX; prevents churn.
- **Trade-offs:** New features must fit existing screens or request a UI change.

### D-012 — Strict quality bar

- **Decision:** No `any`/`@ts-ignore`/`eslint-disable`/TODO/placeholder/mock in shipped code; strict TS; type imports; Prettier/ESLint enforced; Conventional Commits.
- **Reason:** Five-year maintainability; merge-ready always.
- **Trade-offs:** Slower to write; occasional localized sound casts at type-erasure boundaries.

### D-013 — DI without decorators

- **Decision:** Token-based DI container (values + singleton/transient factories + scopes); no `reflect-metadata`.
- **Reason:** Composition over inheritance; no metadata/runtime magic.
- **Trade-offs:** Manual registration; no auto-wiring.

### D-014 — Object storage S3-compatible; secrets env/file (Vault-ready); observability OpenTelemetry

- **Decision:** MinIO (dev) behind an S3 abstraction; `SecretProvider` (env + Docker file, Vault-ready); OTel for tracing/metrics + the kernel logger.
- **Reason:** First-party, portable, vendor-neutral.
- **Trade-offs:** Vault/Sentry concretes deferred to later sprints.

### D-015 — No business DB models yet

- **Decision:** Prisma schema is infrastructure-only (no models) until business sprints; first migration lands with the first bounded context.
- **Reason:** Foundations before features; avoid speculative schema.
- **Trade-offs:** Repository adapter is abstract until a concrete model exists.

### D-016 — Toolchain pins

- **Decision:** `packageManager = pnpm@11.9.0`; pnpm-11 lockfile; `minimumReleaseAge` supply-chain policy; `allowBuilds` allowlist; npm scope `@platform/*`; root folder `lumo-platform`.
- **Reason:** Reproducible installs in the available environment; supply-chain safety.
- **Trade-offs:** Fresh resolves need policy-aware handling; scope/folder names are fixed.

### D-017 — Architecture changes are ADR-gated

- **Decision:** Any change to the contract in `docs/architecture/` (or a frozen invariant) requires a numbered ADR before code.
- **Reason:** Prevent silent architecture drift across AI sessions.
- **Trade-offs:** Slight process overhead for changes.

### D-018 — Outbound ports live in dedicated contract packages, never inside a layer

- **Decision:** Outbound port **interfaces** live in leaf packages, not inside `@platform/application`. Persistence ports stay in `@platform/repository` (D-006); other cross-cutting outbound ports (`IdGenerator`, `Clock`) live in `@platform/contracts` (interfaces only, no runtime deps). **DI tokens stay in `@platform/application`** (co-located with the container). Infrastructure adapters depend only on the contract package, never on the application layer. ([ADR-0002](architecture/adr/0002-outbound-ports-in-contracts-package.md); resolves review finding M1.)
- **Reason:** Consistency with D-006; lean adapters (no dependency on the whole application kernel); dependency direction stays inward.
- **Trade-offs:** One extra package; a port's interface and its DI token live in different packages (contract vs. wiring handle).

### D-019 — Time through a `Clock` port (Dependency Inversion)

- **Decision:** Reading the current time is an outbound port: `Clock` interface in `@platform/contracts`, `CLOCK` token in `@platform/application`, `SystemClock` adapter in infra `@platform/clock`. The domain never reads the clock (timestamps are supplied, D-010); application/infra obtain time via the port. _(Resolves review finding M3; abstraction only — no business wiring.)_
- **Reason:** Symmetry with the `IdGenerator` port (D-009); deterministic testing (inject a fixed clock); no hidden `new Date()` side effects.
- **Trade-offs:** One extra package + DI wiring for a small concern.

### D-020 — Value objects are deeply immutable

- **Decision:** `ValueObject` deep-freezes its props at construction (plain objects + arrays, recursively; no cycle handling — props are acyclic data), replacing the previous shallow `Object.freeze`. _(Resolves review finding M4.)_
- **Reason:** Composite value objects (nested objects/arrays) must be truly immutable for sound equality and aliasing safety.
- **Trade-offs:** Small construction cost; nested props must be acyclic plain data.

### D-021 — `UniqueEntityId` rejects empty/whitespace values

- **Decision:** `UniqueEntityId.from(value)` validates with `Guard.againstEmpty` and **throws** the kernel `ValidationError` for empty or whitespace-only input. The public API stays `from(value): UniqueEntityId` (not `Result`). _(Resolves review finding M5.)_
- **Reason:** An empty identity is an invariant violation / corrupt input — fail loud at the construction boundary. Reuses the existing Guard + kernel error (D-005).
- **Trade-offs:** `from()` can throw (an exceptional path, distinct from expected input validation, which uses `Guard` + `Result`).

### D-022 — Application-generated ids are UUIDv7 (RFC 9562)

- **Decision:** `CryptoIdGenerator` produces **UUIDv7** (48-bit ms timestamp + random) using `node:crypto` only — no external dependency. Aligns the implementation with the documented time-ordered id strategy. _(Resolves review finding M2; chosen over an ADR for v4.)_
- **Reason:** Time-ordered ids preserve B-tree/index locality; removes the prior v4 drift. No new dependency keeps the supply-chain policy (D-016) intact.
- **Trade-offs:** UUIDv7 embeds a creation timestamp (minor information exposure) — acceptable for internal ids; hand-rolled generation is covered by format + ordering tests.

### D-023 — Event backbone: classic outbox in two packages

- **Decision:** Cross-context integration-event **contracts** (envelope, topic/versioning helpers, `EventSerializer`) live in `@platform/domain-events` (a leaf — the only async coupling surface). The **runtime** (transactional outbox write-side, `EventPublisher`/`EventConsumer`, `ProcessedEventStore`, `DeadLetterStore`, `RetryPolicy`, in-memory adapters) lives in `@platform/messaging`. Classic DDD + Outbox — **no CQRS/Event Sourcing**. The `OutboxWriter` is invoked by infrastructure (the persistence boundary) and writes only to the outbox inside the aggregate's transaction; `correlationId`/`causationId` live only on integration events (domain events stay pure). Messaging ports stay in `@platform/messaging` (not `@platform/contracts`, which keeps only universal ports). Dependency direction `domain ← application ← messaging ← infrastructure`. (Sprint 0.6; no ADR — the architecture contract docs 02/05 are unchanged.)
- **Reason:** Reuses `@platform/domain` events + `@platform/repository` transactions; lean coupling surface; testable without a broker.
- **Trade-offs:** Two packages; the outbox write is an infrastructure responsibility (the application stays messaging-free).

### D-024 — Serialization is an abstraction; production codec deferred

- **Decision:** `EventSerializer` is an interface; the **production** implementation (Avro/Protobuf via the schema registry) is intentionally **unimplemented** in Sprint 0.6. A **test-only** `InMemoryEventSerializer` lives at `@platform/domain-events/testing`. There is **no JSON production default**. The envelope uses only primitive field types so it is already Avro-compatible (no future migration). Redpanda/Debezium/Apicurio adapters are deferred to the broker-wiring sprint (D-A). (Sprint 0.6; no ADR — defers adapters the contract already names, without changing its rules.)
- **Reason:** YAGNI + the current environment has no broker/registry; avoids committing to a wire codec prematurely while keeping the contract stable.
- **Trade-offs:** No end-to-end broker test until the wiring sprint; the in-memory serializer encodes via JSON internally (test-only, not the production format).

### D-025 — Auth/authz seams as ports; minimal feature flags

- **Decision:** Authentication + authorization are **ports added to `@platform/contracts`** (`Principal`/`PrincipalKind`; `Authenticator` → `Principal | null`; `Permission`; `AccessControl` → `boolean`) — **no `@platform/security` package** and **no audit subsystem** (deferred until a real producer). `AuthenticationError` (401) + `AuthorizationError` (403) added to `@platform/utils` (single error home, D-005). `@platform/feature-flags` ships only `FeatureFlags` + `EvaluationContext` + `InMemoryFeatureFlags`; rollout/percentage/multivariate/targeting + the source of truth belong to the future Experimentation implementation. **No DI tokens** (consumers inject by constructor at their composition root). (Sprint 0.7; no ADR — contract docs 07/12/14 unchanged.)
- **Reason:** YAGNI — only seams with an immediate Phase-1 (1.x) consumer; provider-agnostic like 0.6; `@platform/contracts` stays a leaf because the ports return `Principal | null` / `boolean` (no `Result`/error coupling).
- **Trade-offs:** RBAC/Ory/Keto/audit/rollout deferred to focused later work; resource-level authz is added later via an optional argument (non-breaking).

### D-026 — Phase-1 bounded-context conventions (Catalog + Media)

- **Decision:** Business contexts are independent `services/<context>/` Clean-Architecture slices. (a) **VO factories return `Result`** for expected input validation (via `Guard`); **aggregate invariant violations throw `DomainError`** (caught by the use-case into the `Result` channel) — matching `UseCase` semantics. (b) **Value objects are context-local** (`Money`, `Slug`, …) until ≥3 contexts need identical semantics (rule of three), then promoted to the shared kernel. (c) **Cross-context references are bare ids** (`MediaRef` → a Media asset id); no cross-context source import or DB FK. (d) **Interfaces are framework-agnostic** — controllers + a `present()` mapper (`Result` → status + the `@platform/utils` error envelope); no HTTP server yet. (e) **In-memory persistence + outbox** (Prisma/broker deferred). (Sprint 1.1; no ADR — conforms to docs/architecture/02–05 + the 0.5 design.)
- **Reason:** YAGNI + bounded-context independence; extend the existing kernel/contracts/messaging rather than add abstractions; keep `pnpm arch` green.
- **Trade-offs:** No real ACID/durability until Prisma is wired; minor `present()` duplication across contexts (promote to a shared interfaces-kit when HTTP lands).

### D-027 — Pricing + Inventory conventions (Sprint 1.2)

- **Decision:** Extends D-026 for two more contexts. (a) **`Money` stays context-local** — now duplicated in Catalog + Pricing (2 contexts); promote to the shared kernel only at the **third** consumer (rule of three). `Currency` is a new Pricing-local VO. (b) **Inventory emits a single `inventory.adjusted` integration event** carrying a `reason` (`received`/`adjusted`/`reserved`/`released`) + resulting levels — covering all stock mutations; separate `stock.reserved`/`released`/`low` events are deferred (per the 1.2 scope). (c) **`StockLevel` is a rich immutable VO** whose `receive`/`reserve`/`release`/`adjustTo` return new levels and throw `BusinessRuleError` on invariant violations (caught into the `Result` channel). (d) Cross-context refs by bare id (`ProductRef` in both contexts; reservation order/cart reference). (Sprint 1.2; no ADR — conforms to docs/architecture/02–05, the 0.5 design, and D-026.)
- **Reason:** YAGNI + bounded-context independence; reuse the kernel/messaging; keep `pnpm arch` green.
- **Trade-offs:** `Money`/`present()`/`InMemoryUnitOfWork`/`ProductRef` now duplicated across Phase-1 contexts — candidates for kernel/shared-kit promotion once shapes stabilise (deferred).

### D-028 — Cart conventions + deferred kernel promotion (Sprint 1.3)

- **Decision:** `@platform/cart` follows D-026/D-027. (a) **Caller-supplied price snapshot** — `AddItem` takes `unitPriceAmountMinor` + `currency`; the line stores the snapshot and Cart never imports/calls Pricing (the live Pricing-quote gRPC client is deferred). (b) **`cart.checked_out` is published via the outbox** as the trigger for the Sprint 1.4 checkout saga, which owns stock reservation against Inventory — Cart does **not** call Inventory and does not validate stock in 1.3; `cart.abandoned` is also emitted (consumer deferred). (c) **Single-currency cart invariant** (enforced in the aggregate and by `Money.plus`). (d) **No `CartId` VO** — the aggregate id is `UniqueEntityId` (a branded id would duplicate it; YAGNI). (e) Cart's `Money` is context-local but **carries `times`/`plus` arithmetic** the Catalog/Pricing copies lack.
- **Rule of Three — reached, promotion deferred:** with Cart, `Money` is now in **3** contexts (Catalog/Pricing/Cart) and `ProductRef` in **3** (Pricing/Inventory/Cart). Promotion to `@platform/domain` is the correct next move, **but it requires migrating the already-committed Catalog/Pricing/Inventory contexts** — out of scope for 1.3 (refactoring previous sprints was not required to complete Cart) and complicated by the three `Money` copies differing in behaviour. **Recommendation:** a dedicated `MoneyKernelPromotion` refactor introduces a reconciled kernel `Money` (+ `ProductRef`/`EntityRef`) and migrates all consumers in one focused change. (Sprint 1.3; no ADR — conforms to docs/architecture/02–05, the 0.5 design, D-026, D-027.)
- **Reason:** YAGNI + bounded-context independence; honour "don't refactor previous sprints unless required" while recording the rule-of-three trigger as actionable debt rather than silently adding a 3rd local copy without note.
- **Trade-offs:** a third context-local `Money`/`ProductRef` persists until the promotion refactor; the price snapshot can go stale (price-refresh-on-read is a deferred Pricing-client concern).

### D-029 — `Money`/`ProductRef` kernel promotion scheduled as Sprint 1.4 step 0 (Architecture Debt Policy)

- **Decision:** Under the Architecture Debt Policy, the Rule-of-Three promotion deferred in D-028 is **no longer open-ended**: it is **scheduled as the first, independently-gated task of Sprint 1.4**, performed **before** any Checkout/Orders/Payments code. Requirements: (1) design the **final kernel API** for `Money` and `ProductRef` accounting for **all** consumers — Catalog, Pricing, Cart, **and the incoming Orders + Payments** (which raise `Money` to 5 consumers and make promotion unavoidable) — reconciling the divergent `Money` shapes (Pricing's `Currency`-VO form vs Cart's `currency: string` + `times`/`plus` arithmetic); (2) promote both to `@platform/domain`; (3) **migrate every existing context in the same refactor**; (4) run the full gates (lint, typecheck, test, build, arch) — all green — as a discrete step; (5) only then begin Checkout. The refactor must be independent, behaviour-preserving, documented, and clearly separated from the 1.4 feature work.
- **Reason:** Rule of three is already reached (Money ×3, ProductRef ×3) and 1.4 forces it further; deferring indefinitely accumulates debt, while promoting now (no active sprint) would fix a kernel API before its heaviest consumers define it. Pinning it to 1.4 step 0 resolves both.
- **Trade-offs:** the duplicate VOs persist one sprint longer; in exchange the kernel `Money` shape is designed once, against the complete consumer set, instead of being promoted then reworked.

### D-030 — `Money`/`ProductRef` promoted to the kernel (Sprint 1.4 Step 0, executed)

- **Decision:** Executed the D-029 refactor as Step 0. `Money` and `ProductRef` now live **only** in `@platform/domain` (`shared/value-objects/`); the six context-local copies (catalog/pricing/cart `Money`, pricing/inventory/cart `ProductRef`) were deleted and every consumer migrated. **Canonical `Money`:** `create(amountMinor, currency: string)` (a **string** currency, not a `Currency` VO) requiring a **non-negative** integer; `zero`; arithmetic `plus`/`minus`/`times` + comparisons `isGreaterThan`/`isZero`, all currency-checked and throwing `BusinessRuleError` on a mismatch or negative result. This reconciles the three prior shapes (Catalog's getters-only, Pricing's `Currency`-VO form, Cart's `string` + `times`/`plus`): the kernel uses the **string** currency (Pricing keeps its own `Currency` VO for code validation and passes `.code` in) and the **superset of arithmetic** Orders/Payments need. **Canonical `ProductRef`:** unchanged (`Guard.againstEmpty`). `Currency` (Pricing) and `Quantity` (Inventory/Cart) stayed context-local — not at rule of three, and out of the promotion's scope.
- **Behaviour preservation:** all five gates green before continuing; the only behavioural tightening is `Money` now rejecting negative amounts (previously Catalog/Pricing accepted any integer) — no existing test or call relied on negatives, and non-negativity is the correct invariant for all consumers. Independent + separated from the feature work (its own recommended commit).
- **Reason:** Architecture Debt Policy + D-029. Rule of three was reached and Orders/Payments raise `Money` to 5 consumers; promoting once, against the full consumer set, removes the duplication for good.
- **Trade-offs:** a one-time edit touched four previously-committed contexts (imports + Pricing's `Money(Currency)`→`Money(string)` call sites); justified and required to complete the promotion. `present()`/`InMemoryUnitOfWork` remain intentionally per-context (not at a clean rule-of-three for promotion yet).

### D-031 — Checkout + Orders + Payments conventions (Sprint 1.4)

- **Decision:** Three independent Clean-Architecture slices following D-026/D-027/D-028, all on the kernel `Money`. (a) **Orders** — `Order` aggregate with status **derived** from an append-only `OrderEvent` history (`placed`→`paid`→`refunded`); line products are immutable **snapshots** (`ProductSnapshot`/`AddressSnapshot`), never live refs; a `RefundPolicy` **domain service** gates refunds (paid-only); events `order.{placed,paid,refunded}`. (b) **Payments** — `PaymentIntent` aggregate (`Charge`/`Refund` entities; `PspToken`/`PaymentStatus` VOs); refunds bounded by the captured amount via `Money` arithmetic; events `payment.{captured,failed,refunded}`; never stores raw card data. (c) **Checkout** — `CheckoutSession` aggregate (`CheckoutState` VO) emitting `checkout.{completed,failed}`. (d) **The cross-context purchase-saga orchestration is deferred** (needs Temporal + gRPC clients — no Docker host): each context is independent, references others by **bare id**, and communicates via outbox integration events; the saga will drive these aggregates. No cross-context imports. (Sprint 1.4; no ADR — conforms to docs/architecture/02–05 + the 0.5 design.)
- **Reason:** YAGNI + bounded-context independence; deliver the aggregates + lifecycle events the saga needs without prematurely building orchestration that requires deferred infrastructure.
- **Trade-offs:** Checkout cannot yet _drive_ the end-to-end purchase (no orchestrator/clients); Orders/Payments are exercised directly. `present()`/`InMemoryUnitOfWork` duplicated per context (intentional). No `CheckoutId`/`OrderId` branded VOs (`UniqueEntityId` suffices; YAGNI).

### D-032 — Identity conventions (Sprint 1.5)

- **Decision:** `@platform/identity` (the last Phase-1 context) follows D-026/D-031. `Customer` aggregate (raises `customer.registered`, `consent.changed`) with `Address` + append-only `ConsentRecord` entities and `Email` + `ConsentScope` VOs. (a) **Consent is derived** from the latest record per scope — `ConsentRecord` is insert-only, never mutated (mirrors Orders' append-only `OrderEvent`). (b) **`Email` is the natural key** — `RegisterCustomer` enforces uniqueness via `CustomerRepository.findByEmail` and returns a `ConflictError` (409) on a duplicate (a correctness rule, not a speculative abstraction). (c) **`Email`/`ConsentScope` stay context-local** — Identity is their only consumer (not at rule of three; `Address` here is an owned **entity**, distinct from Orders' `AddressSnapshot` VO). (d) **`ConsentScope` is a closed Phase-1 set** (`marketing`/`analytics`/`data_sharing`). (e) **Auth is not implemented** — the `Authenticator`/`AccessControl` **ports** already exist in `@platform/contracts` (0.7); an Ory adapter + encrypted PII are deferred. Households/child-profiles/ReBAC are explicitly out (YAGNI, per the 0.5 design). (Sprint 1.5; no ADR — conforms to docs/architecture/02–05 + the 0.5 design.)
- **Reason:** YAGNI + bounded-context independence; deliver customer/address/consent only, reusing the kernel/messaging and the existing auth ports.
- **Trade-offs:** email uniqueness is enforced via a store scan (fine in-memory; a Postgres unique index replaces it); consent fields are not yet encrypted; `present()`/`InMemoryUnitOfWork` duplicated per context (intentional). **Phase-1 contexts are now complete (9 of 9).**

### D-033 — Admin wiring lives in `apps/admin` as a framework-agnostic facade (Sprint 1.6)

- **Decision:** The Phase-1 admin wiring is a new **app** package `@platform/admin` at `apps/admin` — a composition/BFF layer, **not** a bounded context. It wires the six frozen Phase-1 admin screens (Products, Inventory, Orders, Customers, Discounts, Coupons) to their owning contexts (Catalog, Inventory, Orders, Identity, Pricing) via thin **facade controllers** that delegate to each context's existing public controller and return its `ControllerResponse` unchanged (aliased `AdminResponse`). **No business behaviour is added or changed**; presentation stays owned by each context's presenter (never re-mapped). (a) **Placement in `apps/`** is deliberate and required: the `no-cross-service-internals` fitness rule forbids a _service_ importing another service, but `apps/` is the composition root and is exempt — so only an app may legally aggregate several contexts' public APIs (`pnpm arch` stays green; 0 violations). (b) **Typed pass-through** uses `Parameters<Controller["method"]>` so the admin never re-declares or needs the contexts to export input types. (c) **Only actions backed by an existing use-case are exposed**; unbacked screen actions (fulfillment, returns, transfers, segmentation, dedicated coupon/discount-rule codes) are **deferred, not stubbed** — the Discounts/Coupons screens map to Pricing's existing Price/PriceList surface (the 0.5 design's `Coupon`/`DiscountRule` aggregates were not built in Sprint 1.2). (d) **No HTTP server** (framework ban): an HTTP/RPC transport adapter that lets the Morbeh Design System call these facades is deferred, along with the admin cross-cutting baseline (tracking, audit-on-mutation, RBAC/ReBAC, flag gating, bulk-action jobs — `docs/admin/01` §2/§4). The 19 non-Phase-1 admin screens belong to later phases. (Sprint 1.6; no ADR — conforms to `docs/admin/01`, the roadmap, and the frozen-UI contract.)
- **Reason:** Wire functionality **behind the frozen controls** without touching UI or domain logic, honouring the framework bans; `apps/` is the only arch-legal home for cross-context composition.
- **Trade-offs:** the facades are thin (near-passthrough) — accepted, because their value is the screen→context mapping + the arch-legal composition seam, not new logic; the wiring is only reachable in-process/tests until the transport adapter lands.

### D-034 — Transaction context flows through repository ports (ADR-0003)

- **Decision:** Every repository port method takes a trailing optional `tx?: unknown`; use cases pass the context received from `TransactionalUnitOfWork.run(async (tx) => …)` to every repository call inside the boundary; infrastructure forwards it to the outbox append. Prisma adapters narrow `tx` and fail loudly when it is missing. ([ADR-0003](architecture/adr/0003-transaction-context-through-repository-ports.md))
- **Reason:** The transactional-outbox guarantee (aggregate write + outbox row in one transaction) was structurally unimplementable — the context never reached repositories. Explicit propagation keeps D-013 (no runtime magic).
- **Trade-offs:** An `unknown` parameter on otherwise persistence-free domain ports; callers must pass `tx` (adapter fail-loud is the backstop).

### D-035 — Tenant-ready event envelope; canonical 3-segment event names (ADR-0004)

- **Decision:** `IntegrationEvent` reserves optional `tenantId` + `producer` (also stamped as headers); `EventContext` carries optional `tenantId`; every composition names its `producer`. Event naming is canonically `<context>.<aggregate>.<event>`; doc 20 gains a reconciliation table of implemented topics as the source of truth. The tenancy _model_ (per-deployment vs shared) remains an explicit open decision required **before Phase 2**.
- **Reason:** Adding fields to live topics later is a breaking schema migration; reserving them now is free. 17 implemented events had already drifted from the catalog.
- **Trade-offs:** Optional fields cannot enforce tenancy yet; `trace_id` propagation still deferred to the broker sprint.

### D-036 — Atomic consumer idempotency: `recordIfNew` (ADR-0005)

- **Decision:** `ProcessedEventStore` replaces `record()` with atomic `recordIfNew(messageId, processedAt, tx?) → boolean`; `has()` is a fast pre-check only. The consumer logs a detected concurrent duplicate; production adapters implement a unique-constraint INSERT, ideally inside the handler's transaction.
- **Reason:** `has→handle→record` was check-then-act; duplicate execution of financial handlers is a money bug, and the old port shape made the correct implementation inexpressible.
- **Trade-offs:** Full exactly-once _effect_ still requires the handler's side effects and the marker in one transaction (Prisma adapter, broker sprint); handlers stay idempotent regardless.

### D-037 — Integration events carry no raw PII; logger redacts by default (ADR-0006)

- **Decision:** Translators publish identifiers, not PII (`customer.registered` now carries `{ customerId }` only); consumers fetch profile data from the owning context. The kernel logger redacts a built-in sensitive-key list (credentials + direct PII) recursively and by default; extending is additive, disabling is an explicit opt-out.
- **Reason:** Long-retained, effectively immutable topics containing raw PII turn GDPR erasure into crypto-shredding/topic rewrites; opt-in shallow redaction leaks by default.
- **Trade-offs:** Consumers pay an owning-context lookup for profile data; default redaction may occasionally mask a benign field.

### D-038 — Admin actions authorize an explicit `Principal` (ADR-0007)

- **Decision:** Every admin facade method takes `principal: Principal` first and authorizes `"<module>:<action>"` via the `AccessControl` port before delegating; denial is a transport-neutral 403 envelope (the only admin-owned response shape). `wireAdmin` defaults to a permissive `AllowAllAccessControl` until Ory/Keto lands; context controllers stay principal-free until a transport exposes them.
- **Reason:** The Sprint-0.7 auth ports had zero consumers; retrofitting principals after the transport sprint would churn every signature and test at the worst time. BOLA is OWASP API #1.
- **Trade-offs:** Authorization is permissive until Phase 2 (wiring is in-process only today); ReBAC/ownership checks remain future per doc 07.

### D-039 — Tenant-aware core with tiered physical isolation (ADR-0008)

- **Decision:** Every commercial aggregate belongs to exactly one tenant; `tenantId` is a platform primitive propagated boundary→context→envelope (never modeled inside domain contexts). Default physical model is pooled shared-schema with `(tenant_id, natural_key)` uniqueness, `tenant_id`-led indexes/shard keys, and Postgres RLS as defense-in-depth; enterprise/white-label/residency tenants get dedicated schema/database/deployment tiers via composition only. Prisma schemas carry `tenant_id` from the first migration. A future `Tenancy` context owns merchants/organizations.
- **Reason:** SaaS/marketplace/white-label are the stated future; tenancy is the most expensive retrofit in the system and Phase 2 freezes schemas and topics.
- **Trade-offs:** Composite-key tax on every query/index now; RLS+adapter double enforcement must be tested; `Tenancy` context is deferred scope with a fixed id contract.

### D-040 — Immutable audit trail port; guards are policy-enforcement points (ADR-0009)

- **Decision:** `AuditTrail` (append-only by contract) joins `@platform/contracts`; the admin boundary's `AdminGuard` authorizes **and** audits every action decision (`allow`/`deny`) in one seam, failing the action if the audit write fails. Production adapter appends via the outbox as `audit.entry.recorded` to 7-year archival storage; tamper evidence via append-only + hash chaining at the archive.
- **Reason:** Audit is a SOC2/ISO/PCI blocker that was pure plan; decision-level audit from day one is cheap now and impossible to reconstruct later.
- **Trade-offs:** Outcome-level audit (what changed) still lands with transport middleware + the outbox adapter; in-memory trail is volatile by design.

### D-041 — Third-party extensions out-of-process; themes declarative + sandboxed (ADR-0010)

- **Decision:** Third-party apps are external services touching the platform only via OAuth-scoped public APIs, signed webhooks, and declarative UI slots (the Shopify model); in-process loading of untrusted code is rejected outright. First-party plugins keep doc 11's port/adapter model. Themes are versioned data packages (layouts/templates/sections/blocks/settings) rendered by a sandboxed Liquid-compatible engine — no server-side theme code, allowlisted object model, render budgets, escaping by default. Manifests (id, semver, scopes, webhooks, slots, settings schema, apiVersion) are the contract for both; all lifecycle transitions are tenant-scoped and audited. Contracts: doc 24 (app platform), doc 25 (theme + storefront platform).
- **Reason:** Where untrusted code executes is the platform-defining security/availability decision; the WordPress/Magento in-process model is the documented failure mode at app-store scale.
- **Trade-offs:** Apps pay network latency (bulk APIs + webhooks mitigate); some deep in-process customizations are impossible by design; the sandboxed renderer is a major storefront-phase investment. WASM edge functions remain a revisit-later option.

### D-042 — Persistence adapter conventions (Sprint 2.2)

- **Decision:** Every Prisma repository follows one shape: (a) constructor deps `{ prisma, outbox, context, tenantId }` — tenant scope is injected and applied to every query (ADR-0008 §2); (b) `save` REQUIRES the unit of work's transaction client and fails loudly without it; the outbox append shares that transaction (ADR-0003); (c) optimistic locking is `updateMany WHERE id AND tenant_id AND version` with 0 rows ⇒ `ConcurrencyError` — no retry, no silent overwrite; creates persist `version = 1` (in-memory fresh = 0); (d) aggregates rehydrate via `static reconstitute(...)` (no domain events; persisted version carried) and closed-set VOs via `from(value)`; derived state (order status, consent, payment remaining) is never stored; (e) mapping lives in dedicated mapper classes using structural row interfaces — Prisma types never leave infrastructure, domain imports nothing new; (f) append-only children (order events, consent records, charges, refunds, addresses) persist via `createMany({ skipDuplicates: true })` keyed by entity id; mutable child sets (cart items, reservations) are replaced within the transaction.
- **Reason:** One reviewable pattern across 9 contexts; the transactional-outbox and tenancy guarantees become properties of the shape, not per-repo diligence.
- **Trade-offs:** delete+recreate for mutable child sets is simple but write-amplifying (revisit per-aggregate if hot — inventory's answer is the G-7 ledger); version is not bumped in-memory after save (one save per unit-of-work run by convention).

### D-043 — Infrastructure foundation conventions (Sprint 2.2.5)

- **Decision:** (a) Debezium is the production outbox relay: pgoutput + publication `lumo_outbox`, EventRouter routed by the outbox row''s `topic` column, ByteArrayConverter — the wire envelope is byte-identical to what `OutboxWriter` persisted; (b) every business topic ships with `.retry` and `.dlq` companions pre-created (broker-side redelivery replaces in-process sleep, per ADR-0005 note); retention follows doc-20 keys (30d/13mo/7y-class); (c) four least-privilege compose networks (data/messaging/observability/tools); (d) the OTel Collector is the only telemetry endpoint applications will ever know (OTLP), fanning out to Tempo/Prometheus/Loki; (e) MinIO buckets are purpose-scoped (media/exports/imports/backups) with tenant-prefixed keys — never bucket-per-tenant; (f) prepared-not-enabled: RLS (migration #2), PITR/replica settings, outbox partitioning, `lumo_app` DML-only role.
- **Reason:** Compose is the deployable contract that maps 1:1 onto Kubernetes later (doc 26 §7); every service sits behind an existing port and is replaceable without touching application code.
- **Trade-offs:** Redpanda Console instead of generic Kafka-UI (native Connect integration; Redpanda-flavored ops tooling); single shared Postgres hosts Apicurio''s database locally; publication/connector registration are manual first-boot steps until migration #2 automates the publication.

### D-044 — Redis layer conventions (Sprint 2.3)

- **Decision:** (a) `Cache`/`DistributedLock`/`RateLimiter`/`IdempotencyKeyStore` are outbound ports in `@platform/contracts` (D-018); `Cache` moved there from `@platform/redis` (type re-exported for back-compat). (b) Locks are **efficiency only** — correctness always stays with optimistic locking + idempotency; single-instance token-guarded locks, Redlock rejected. (c) Rate limiting is fixed-window Lua v1 (2× edge burst accepted); adapters throw on infra failure and the enforcement point picks fail-open vs fail-closed. (d) Client-request idempotency (`Idempotency-Key`) is a Redis TTL claim with token-guarded release-on-failure — event idempotency remains `ProcessedEventStore` in Postgres (ADR-0005). (e) Caches hold **mapper row DTOs, never aggregates**; reads rehydrate through the context''s mapper; writes **delete** cache entries (rollback-safe), transactional reads bypass the cache; keys are tenant-prefixed (ADR-0008). Cart: Postgres stays the source of truth (D-042); `CachedCartRepository` decorates the durable repository.
- **Reason:** Flash-sale cart reads, future transport rate limits, and duplicate-request protection need Redis primitives without coupling anything to Redis or weakening the tx/outbox invariants.
- **Trade-offs:** Fixed-window burst at edges; one more port family; delete-on-write costs a miss after every save (correct beats warm).

### D-045 — Storage layer conventions (Sprint 2.4)

- **Decision:** (a) Object keys are immutable, produced ONLY by `StorageKeyFactory` (`tenants/<tenantId>/<namespace>/<yyyy>/<mm>/<uuid>[.ext]`); a new version is a new key; `put` is a conditional write (`If-None-Match: *`) and overwrite is a provider-enforced error. (b) Buckets are purpose-scoped (media/exports/imports/backups), tenants are key prefixes — never buckets. (c) Soft delete and retention ride bucket versioning + lifecycle policies (configuration); `delete` in the port is permanent. (d) Upload constraints are allowlist `UploadPolicy` objects validated before bytes move; the `FileScanner` hook is fail-closed for user-upload namespaces (quarantine until `clean`). (e) `ImageTransformer` produces deterministic derived keys and never mutates sources. (f) Contracts stay runtime-agnostic: streams are `ByteStream = AsyncIterable<Uint8Array>`. (g) Descriptor metadata (tenant/owner/context/aggregate/checksum/creator/tags) rides as provider user-metadata and round-trips through `head`.
- **Reason:** CDN-cache-forever media, tenant isolation/erasure by prefix, and 10-year evolvability (scan/transform/one-time-download all have seams) without vendor lock-in.
- **Trade-offs:** Conditional-write capability becomes a hard adapter requirement; immutability means storage growth is managed by lifecycle, not overwrite; the scanner/transformer stay unimplemented until their consuming surfaces exist.

### D-046 — Broker runtime conventions (Sprint 2.5)

- **Decision:** (a) `@platform/kafka` is the broker adapter package (kafkajs; included in the dependency-cruiser layer rules). (b) Producers publish the exact outbox bytes — events are never rebuilt; ordering rides the aggregate-id key + idempotent producer with one in-flight request; the main business publication path remains outbox→Debezium. (c) Consumer groups use `KafkaConsumerRuntime`: `has` → handle → `recordIfNew` (recording first loses crash-between-claim-and-handle messages), failure republishes ORIGINAL bytes to `<topic>.retry` with attempt/due-time headers (5s/30s/2m/10m/1h, then `.dlq`) — in-process sleep retries never reach a consumer group. (d) Dead letters go to both the `.dlq` topic (forensic headers: original topic, group, tenant, trace, attempts, error+stack, timestamp) and `platform.dead_letters` (byte-identical replay). (e) `traceparent`/`tracestate`/`baggage` propagate verbatim through every redelivery hop. (f) Consumer fleets are owned by `ConsumerSupervisor` (health = readiness probe; lag via admin). (g) Cross-context consumers live in the consuming context''s `interfaces/` and call use cases only; `orders.order.paid` may only be caused by the payments-captured consumer or backoffice action (doc 22).
- **Reason:** Broker-side redelivery is the only retry model that survives consumer groups at scale; byte fidelity keeps the outbox the single envelope of record.
- **Trade-offs:** Single retry topic per topic (due-time wait) — tiered retry topics are the scale-up; kafkajs over librdkafka (pure JS today, swappable behind `EventPublisher`); metrics/spans are a seam until G-19.

### D-047 — Transport conventions (Sprint 2.6)

- **Decision:** (a) HTTP transport is `@platform/http`: Fastify strictly as infrastructure; routes are framework-independent `RouteDefinition`s (zod schema + permission + version + handler on parsed input) delegating to the existing controllers — zero business logic in transport, repositories/use cases never called directly. (b) Pipeline order is fixed: authenticate → resolve tenant FIRST (no application code tenant-less, no default tenant) → authorize via ONE policy engine (the injected structural `AdminGuard` twin — packages never import apps) → rate limit per (tenant, principal), fail-closed on admin/API surfaces → zod boundary validation → idempotency claim/replay for unsafe methods → uniform code→status error mapping. (c) OpenAPI is GENERATED from the same zod schemas that validate — one source of truth, spec cannot drift. (d) gRPC contracts are versioned proto packages (`morbeh.<ctx>.v<n>`), runtime-loaded (no manual serialization); static codegen arrives with `@platform/api-clients` (G-18); interceptors are the middleware seam; in-mesh insecure creds only (mTLS at mesh, doc 14 §5). (e) **G-22 resolved:** the Sprint-0.3 CQRS bus stays formally parked — transport delegation to controllers is the adopted composition idiom; revisit only if per-use-case cross-cutting middleware materializes.
- **Reason:** Shopify-shape exposure of the existing contexts with every hardening seam (2.3 Redis ports, ADR-0007/0009 guard, ADR-0008 tenancy) becoming enforced reality at the boundary.
- **Trade-offs:** Fastify/zod/proto-loader are swappable infrastructure choices behind our own abstractions; ajv is bypassed (zod parses); process-level /metrics until G-19.

### D-048 — Identity adapter conventions (Sprint 2.7)

- **Decision:** (a) All identity infrastructure lives in `@platform/auth` behind the frozen ports — business contexts and transport stay provider-agnostic; **no Ory SDK** (raw REST with injectable fetch; three endpoints used). (b) Self-service flows (registration/login/logout/reset/verification/MFA/WebAuthn/social/OIDC/SAML-via-IdP) are Kratos configuration, never platform code; the platform validates sessions, looks up identities, revokes (audited), and receives flow events via webhooks. (c) JWTs verify against JWKS with pinned issuer/audience and bounded clock tolerance; refresh rotation is the issuer''s contract — refresh tokens never reach the verifier; invalid tokens are uniformly `null` → 401. (d) Keto is the `AccessControl` adapter: permission `"<module>:<action>"` = tuple check, roles/hierarchy = subject-sets, tenant-scoped grants extend the tuple object later; **fail-closed always**. (e) Session-validation and authorization-decision caches ride the Sprint-2.3 `Cache` port; the TTL is the explicit revocation-latency window (15s/30s defaults, per-surface). (f) `ClaimsAuthenticator` is an additive contracts extension; the transport consumes verified claims for tenant resolution (claim → header → domain order).
- **Reason:** Shopify-grade identity without owning credential storage or flow orchestration; every seam already had a consumer, so adapters drop in at composition roots only.
- **Trade-offs:** Revocation latency = cache TTLs; Ory API drift is absorbed by contract tests + the tiny REST surface; Hydra (OAuth2 for apps) deferred to the app-platform phase.

### D-049 — Saga implementation conventions (Sprint 2.8)

- **Decision:** Workflow logic lives in a DETERMINISTIC framework-free core (`runPurchaseSaga`) with all effects behind an activities port; the Temporal workflow is a thin adapter (signals/timers/retry profiles only). Two retry profiles: bounded (pre-payment, 5 attempts) and convergent (post-payment truth — unbounded, 5m cap; never auto-unwind a paid order). Capture truth reaches the saga ONLY as a signal originating from the webhook→outbox event. Workflow ids are `purchase:<tenant>:<checkoutSession>`. PSP calls go through the `PaymentProvider` contracts port with per-step idempotency keys; adapters are raw REST (no SDKs, per D-048). Native build scripts required by Temporal are approved via the D-016 allowlist.
- **Reason:** Determinism, replay-safety and compensation semantics become unit-testable without a Temporal server; ADR-0012 stays enforceable in code review (the core cannot import a clock).
- **Trade-offs:** Two layers (core + adapter) to keep in sync — the adapter is deliberately too thin to drift; live workflow execution validates only on a Docker host.

### D-050 — Runtime composition conventions (Sprint 2.9)

- **Decision:** (a) `apps/runtime` hosts the three production processes (api/worker/scheduler) over ONE composition root; every dependency is wired there — application code never instantiates infrastructure. (b) `loadRuntimeConfig` is the only `process.env` reader (zod-typed, field-named startup failures). (c) The composition graph is side-effect-free (lazy clients); connect/start happens only in entrypoints — which is what makes composition unit-testable without Docker. (d) Secure defaults are structural: no JWKS ⇒ no api (no fake identity, D-048); no Keto outside `local` ⇒ composition fails closed. (e) Consumers/activities compose against context APPLICATION layers only (the payments-captured slice is the reference). (f) Scheduler jobs are injected, idempotent, and single-flight via the Redis lock; the interval loop is disposable — the job contract is not. (g) Missing composability is NAMED, never faked: G-39 (production context wiring behind the admin facade), G-40 (payments carries the checkout-session ref so the capture event can signal `purchase:<tenant>:<session>`).
- **Reason:** Turn the component collection into runnable processes without inventing business logic or weakening a single seam.
- **Trade-offs:** The api serves in-memory facade data until G-39 closes; the Temporal worker waits for its activities'' prerequisites; JSON serializer until Apicurio.

### D-051 — Engineering-memory update contract (Sprint 3.0A)

- **Decision:** The repository is the source of truth; chat history is disposable. The memory set is: AI_CONTEXT (append-only dated addenda), PROJECT_STATE (sprint table + current/next), DECISIONS (append-only; ADR first for architectural changes per D-017), MASTER_PROMPT + DEVELOPMENT_PROCESS (workflow), ARCHITECTURE_OVERVIEW (diagrams), CHANGELOG_AI (sprint index), KNOWN_GAPS (open mirror of doc 23 — doc 23 remains master), RELEASE_PROCESS. **No sprint is complete until all applicable files are updated in the same change set** (the sprint-close contract appended to MASTER_PROMPT/DEVELOPMENT_PROCESS). History is never rewritten — corrections append.
- **Reason:** Ten sprints proved the pattern; codifying it makes any future AI session self-sufficient without conversation context.
- **Trade-offs:** Two gap views (doc 23 + KNOWN_GAPS) must both be touched — accepted for the different audiences (full ledger vs open-items triage); drift is caught at sprint close.

### D-052 — Morbeh Design System is the canonical design system (supersedes D-011)

- **Decision:** The **Morbeh Design System** ([docs/ui/MORBEH_DESIGN_SYSTEM.md](ui/MORBEH_DESIGN_SYSTEM.md)) is the platform's one and only design system. Brand primary `#635BFF`; cool-neutral (slate) palette; Geist (Latin) + IBM Plex Sans Arabic (Arabic) at weights 400/500/600; 4px spacing grid; radius 4/6/8/12/16/full; four restrained elevations; Lucide as the sole icon library; motion 100/150/200/300/400ms. Tokens are layered primitive → semantic → Tailwind utility in `packages/design`; components in `packages/ui` consume semantic tokens only and never hard-code a value. `apps/admin-web` is the reference surface (the Morbeh Dashboard). The previous frozen-prototype design system is **retired**: `apps/admin/prototype/` and the five `docs/ui/` prototype specifications are deleted, and `packages/design`/`packages/ui` were evolved in place rather than forked — there is no second system.
- **Reason:** The frozen prototype was a 2026-06 chat-era HTML artefact that had never been implemented in React, defined a flat borders-only visual language with no accessibility guarantees, and blocked every UI change behind an approval gate. A single canonical, token-driven, accessibility-tested system removes that gate and the duplication risk at the same time.
- **Trade-offs:** (a) The admin React surface needed a host — `apps/admin` is a Fastify/facade package with zero `.tsx`, so `apps/admin-web` was added as the Next.js app; it is a new _app_, not a new design system, and it has no deployment pipeline yet. (b) The prototype's 25-screen inventory was documentation of an artefact that was never built; it is gone with the artefact, and screen specs now live with the screens. (c) `--input` is a heavier neutral (500) than a purely aesthetic choice would pick, because a control boundary must clear 3:1 (WCAG 1.4.11).
