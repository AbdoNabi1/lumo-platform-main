# Wave 1c plan review — round 2 (convergence)

**Outcome: seven round-1 blockers resolved; R6 remains blocking.** R9–R12 remain OPTIONAL and do not gate agreement.

Scope: round-1 R1–R8 and accepted OPTIONAL R9–R12 only. Plan citations refer to `docs/superpowers/plans/2026-11-24-shopify-parity-w1c-segments.md` (260 lines). Its line 14 precedence rule applies. Mechanically confirmed exactly one binding amendment block per task, at lines 138, 192, and 237. Superseded original signatures, SQL semantics, and command ordering are not raised again. Accepted design decisions and owner defaults are not reopened. HEAD remains `ec8e599d`.

## R1 — RESOLVED — currency transport and conversion

- **Plan:** lines 200 and 239 specify the narrow store-currency GET before the parameterized GET, currency on `SegmentMembersPage`, the server reader and editor/table props, explicit failure with no editor/no EGP fallback, the real money helpers, and multi-exponent conversion/display oracles.
- **Code:** `apps/admin/src/interfaces/tenancy.admin-controller.ts:220–226` supplies currency/timezone and preserves failed settings reads; `packages/auth/src/role-table-access-control.ts:4–31,40–50` gives operators/viewers orders/customers reads without full settings access. `apps/admin-web/src/lib/products/money.ts:2,33–42,46–50` exports exactly `currencyExponent`, `toMinorUnits`, and `fromMinorUnits`, with precision/safe-integer checks; `lib/format.ts:11–18` formats using that exponent.
- **Route check:** the explicit ordering at plan line 200 and group location at line 166 fit `apps/admin/src/http/admin-routes.ts:1710–1738`: the existing customer group precedes ordinary customer routes. No route-order redesign is necessary.
- **Executed probe:** existing money helpers, transpiled/executed only in memory: EGP `0.29`, JPY `29`, KWD `0.029` each returned 29; JPY `1.5` and KWD `1.2345` returned null; Arabic `١٢٫٣٤` EGP returned 1234; an unsafe integer returned null. Reverse text for 29 was `0.29` / `29` / `0.029`. Exit 0.

## R2 — RESOLVED — GET failure discriminators

- **Plan:** line 241 adds optional status/code only to the GET error branch, parses non-2xx envelopes, names malformed/network/500/UNAVAILABLE tests, and permits the database-empty state only for 503 + UNAVAILABLE. The final Task 3 command includes client tests (line 255).
- **Code:** `apps/admin-web/src/lib/api/client.ts:31–35,133–147` is the actual current union/error path; its mutation path already reads envelope code/status at lines 212–243. Existing 401/403 and 404 early outcomes need not change. `lib/api/customers.ts:52–62,155–166` demonstrates consumers projecting errors or forwarding compatible outcomes.
- **Compatibility verified:** a read-only compiler-API run virtually added ONLY `status?: number` and `code?: string` to the real ApiResult error branch and checked the full admin-web program: **1,620 source files, zero diagnostics, exit 0**. `noEmit: true`, `incremental: false`, and a write-forbidden compiler host prevented source/build-info writes. This proves additive type compatibility, not the future parser implementation.

## R3 — RESOLVED — independent list/count bindings

- **Plan:** line 194 replaces shared params with separate compiled statements/arrays, copies the base before adding list-only cursor/limit, executes each with its own array, and specifies a recording TransactionClient, queued results, tenant setup ordering, page/search/empty cases, and unchanged totals across pages.
- **Code:** `packages/db/src/transaction.ts:41–50,67–72` sets the tenant through `$executeRaw` before passing the client to the callback, which the specified `$transaction` double can exercise. Installed generated `.prisma/client/index.d.ts:986,15307` exposes variadic `$queryRawUnsafe` on TransactionClient. `services/orders/src/infrastructure/prisma-sales-summary-query.ts:97–124` is the existing raw-query precedent. The separate arrays eliminate R3's prescribed parameter mismatch.

## R4 — RESOLVED — zero-order and NULL predicates

- **Plan:** line 196 coalesces count/spend in predicates and output, preserves null last-order time, defines each last-order operator's NULL behavior, uses `IS DISTINCT FROM` for language neq including unset, and supplies exact zero/refunded expectations. Original country not_in and tags has_none remain NOT EXISTS semantics (line 160).
- **Code:** `packages/db/prisma/schema/identity.prisma:12,16–18,60–90` confirms nullable language and address/consent columns; `schema/orders.prisma:5–33` confirms the absent aggregate-producing row for unpurchased customers. `services/orders/src/infrastructure/prisma-sales-summary-query.ts:99–120` confirms coalesced monetary totals and refund/cancellation treatment. The amendment now governs predicates, not merely displayed values.

## R5 — RESOLVED — per-alias tenant proof

- **Plan:** line 198 replaces the aggregate predicate count with fixed aliases and each alias's own tenant predicate in BOTH statements, including item fallback and separate consent scopes. Adversarial foreign-tenant references must leave tenant A's membership/count/spend unchanged.
- **Code:** `packages/db/prisma/schema/orders.prisma:7–9,37–49,58–65` confirms separate tenant columns and non-tenant-composite references; `schema/identity.prisma:29–40,60–90` confirms the corresponding tag/address/consent fixture possibility. The amended per-alias compiler oracle plus adversarial fixtures addresses the original weak proof. No new isolation strategy is requested.

## R6 — STILL BLOCKING — accepted lock's call shape and memory semantics

**Only plan line 142 remains blocking.** Keep the accepted tenant advisory transaction lock and lock → count → save order. Two instructions inside that authoritative amendment still fail the existing hard-cap requirement:

### A. The literal query selects an unsupported result type

The amendment prescribes `$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'identity.customer_segments:' + tenantId)`. PostgreSQL documents a `void` return type [P1]. Local introspection identified Prisma **6.19.3**, engine **`c2990dca591cba766e3b7ef5d9e8a84796e47ab7`**. At that exact engine commit, `native/column_type.rs:49–65,90–125` has no void mapping, and `native/conversion.rs:650–666` attempts an unknown result as a string, mapping WrongType to UnsupportedColumnType [P2–P3]. Upstream postgres-types string acceptance excludes void [P5]. **Static conclusion:** the literal call is expected to reject during result decoding, before count/save. No database reproduction is claimed.

**Narrow correction:** retain the identical tenant key and transaction-level lock, but execute the side effect with `$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'identity.customer_segments:' + tenantId)`, or explicitly select/cast a supported result. Installed generated `.prisma/client/index.d.ts:963,986,15307` confirms both methods exist on TransactionClient. The matching engine's `native/mod.rs:607–629` executes without converting returned row values, unlike query at lines 421–455 [P4]. Add a recording-adapter assertion for the chosen lock call before count/save; retain the existing disposable-DB concurrency oracle. This corrects the accepted mechanism's call shape, not its design.

### B. A no-op memory lock is not serialization across awaits

The same line says “In-memory: resolves immediately (single-threaded).” Actual `services/identity/src/infrastructure/in-memory-unit-of-work.ts:4–6` just invokes the async callback, and `services/identity/src/composition.ts:269–270` wires it. Neither holds a critical section across separately awaited count/save operations.

**Executed evidence:** an inline probe loaded the REAL existing InMemoryUnitOfWork through in-memory transpilation and exercised the amendment's prospective no-op-lock / awaited-count / save control flow at 99: observed counts **`[99,99]`**, outcomes **`["ok","ok"]`**, final count **101**, exit 0. This demonstrates the proposed sequence's interleaving, not execution of an unbuilt segment repository.

**Narrow correction:** specify transaction-lifetime serialization for the memory segment-create sequence, or an atomic cap recheck/enforcement in memory save; a lock released before count/save is insufficient. Require the existing parallel-at-99 oracle for memory too: one success, one BUSINESS_RULE, final count 100. This closes R6's already-requested invariant/memory parity, not new feature scope.

Precedence cannot repair instructions inside the winning amendment itself. These are **one unresolved round-1 finding (R6)**, not two new findings.

## R7 — RESOLVED — existing Customers composition

- **Plan:** line 243 names existing page/client/toolbar files and tests; threads segment through URL/client/page/Suspense/results; expands hasFilters; keeps Previous on empty later pages; distinguishes store-empty from filtered-empty; defines stale segment handling; and specifies current-params/debounce cancellation with the typed-search/new-segment outcome.
- **Code:** `apps/admin-web/src/app/customers/page.tsx:19–25,54–69,76–131` contains the actual missing prop/key and early-empty seams. `components/customers/customers-toolbar.tsx:26–50` contains the delayed closure. `lib/api/customers.ts:28–62` currently lacks segmentId and collapses not_found; the amendment includes that client/result integration and explicit 404 UI. The instructions now reach the real composition, preserving unfiltered behavior rather than stopping at a select.

## R8 — RESOLVED — persisted versions and snapshots

- **Plan:** line 140 replaces void save with `Promise<number>`, defines 0 → persisted 1 and v → persisted v+1, returns the persisted update token without mutating AggregateRoot, requires immutable stored snapshots/fresh aggregates, and supplies v1/v2/v3 plus stale-writer parity tests.
- **Code:** `packages/domain/src/shared/aggregate/aggregate-root.ts:13–21` confirms readonly version; `services/identity/src/infrastructure/prisma-customer-repository.ts:48–75` increments storage rather than the input object. `in-memory-customer-repository.ts:39–56` stores/returns references, which the amendment expressly avoids. R8's token/reference issue is settled independently of R6.

## Accepted OPTIONAL R9–R12 (not upgraded)

- **R9 — incorporated:** lines 245–252 supply direct action signatures, form state, conditions/expectedVersion, key ownership, preview first=10/no key, revalidation/navigation, message-specific 409 mapping with generic fallback, and server-loaded `?from=<segmentId>` prefill. Actual envelope support exists at `apps/admin-web/src/lib/api/client.ts:212–243`. No action-contract reopening.
- **R10 — incorporated:** line 144 explicitly overrides command sequencing: edit schema/migration → validate → generate → tests/typechecks → arch → scanner. DB-gated suites remain skipped locally for disposable CI. `packages/db/package.json:18,23,25–27` confirms generation/schema configuration.
- **R11 — incorporated:** line 204 pins highest-ID consent ties, equal-time fixtures per channel, and older-read alignment as a follow-up. `services/identity/src/infrastructure/prisma-customer-repository.ts:98–100,114–116` confirms those older reads order only by occurredAt.
- **R12 — incorporated:** line 202 supersedes timestamptz day arithmetic with rolling UTC timestamp arithmetic and names totals precedence, bigint multiplication, both refunds, currency exclusion, and Cairo calendar-boundary oracles. `services/orders/src/infrastructure/prisma-sales-summary-query.ts:61–64,99–120` confirms the referenced money/time conventions. No additional performance/calendar scope is made blocking.

## Primary sources for R6's call-shape check

Source reads only, not DB execution. P2–P4 are pinned to the installed engine commit.

- **P1:** PostgreSQL advisory-lock documentation: `https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS`.
- **P2:** type mapping: `https://raw.githubusercontent.com/prisma/prisma-engines/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/column_type.rs`.
- **P3:** conversion/error path: `https://raw.githubusercontent.com/prisma/prisma-engines/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/conversion.rs`.
- **P4:** query versus execute paths: `https://raw.githubusercontent.com/prisma/prisma-engines/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres/native/mod.rs`.
- **P5:** string acceptance, lines 668–709: `https://raw.githubusercontent.com/sfackler/rust-postgres/master/postgres-types/src/lib.rs` (upstream supporting source, not claimed as the installed dependency's pinned revision).

## Verification and boundaries

Read AGENTS.md, the full plan, round-1 findings/triage, and cited real code. Mechanically checked all twelve finding anchors and one binding block per task. Read-only Node probes verified existing money helpers, installed Prisma/declarations, full-program optional-field compatibility, and the real memory-UoW control flow. All exited 0; the last probe deliberately demonstrates the remaining proposed-sequence failure, not a passing segment concurrency test.

No pnpm, install, build, suite, Prisma generation/validation/migration, DB connection/query, source edit, or git write. This is plan review, not certification of the unbuilt feature. Only this review file was created/updated; unrelated existing documentation/reports were left alone.

VERDICT: CHANGES_REQUESTED (1 blocking)

## Opus triage (round 2)

- R6 (still blocking: void result + no-op memory lock) → accepted. Task 1 `Amendments round 2 (binding)`: lock via `$executeRawUnsafe` (side effect, no void decode) with a recording test of the call order; the port exposes `withTenantSegmentsLock(tenantId, fn)` — Prisma advisory lock in the same tx, in-memory per-tenant queued mutex — and count + save run inside it; in-memory concurrency test at 99. Precedence: round 2 > round 1 > task text.
