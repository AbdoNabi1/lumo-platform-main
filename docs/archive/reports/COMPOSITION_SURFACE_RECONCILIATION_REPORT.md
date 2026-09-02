# Composition Surface Reconciliation Report

## 1. Executive Summary

This is **one coherent, internally-consistent unit of work** — not several unrelated evolutions that happened to land in the same working tree. The evidence for coherence is strong at the _pattern_ level (every one of the seven originally-named packages, plus five more discovered during this pass, shares the same additive `activities`/`queries` composition convention, the same "real adapter vs. in-memory stub" wiring idiom, and a self-cited name — **"Integration Sprint"** — that recurs across 29 files in at least 12 packages and both app composition roots, dated consistently to **2026-07-26** for its one explicit architecture correction). It is **not**, however, evidenced at the _primary-source_ tier this recovery's methodology requires for a clean commit. No Recovery Plan entry, Sprint Report, or ADR names this work; it exists only as self-citing docstrings inside the uncommitted `lumo-platform` working tree — tier 6 (verification-only) evidence by `RECOVERY_IMPLEMENTATION_METHODOLOGY.md`'s own ranking, never a valid implementation source.

Two already-committed documents meaningfully raise confidence above "zero evidence": **ADR-0012** (purchase saga & PSP, Accepted, Sprint 2.8) legitimizes the general five-step orchestration shape (Pricing→Inventory→Payments→Orders→Checkout, with Notifications), and **D-050** (Runtime composition conventions, Sprint 2.9) already establishes the general principle "(e) Consumers/activities compose against context APPLICATION layers only" — the architectural seed of the `activities` pattern used everywhere in this reshaping. `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md` / `IMPLEMENTATION_DEPENDENCY_GRAPH.md` / `ARCHITECTURE_EXECUTION_MATRIX.md` (already committed) go further: they audit `apps/runtime/src/purchase-saga-activities.ts`, `AdvanceOrder`, `order-lifecycle.use-cases.ts`, `payment-captured.consumer.ts`, and `RecordWebhook`'s transition table as **already-existing, already-buggy code** (findings SAGA-1 through SAGA-11, all "CONFIRMED"), planning further remediation _on top of_ the very surface this report is investigating. That is real corroboration of scope and file locations — but it is an audit of an artifact, not a specification for reconstructing it, and it does not name the specific new class/method symbols.

**Overall confidence this can be reconstructed at all: Medium for the general shape and file scope, Low for exact signatures.** A disciplined reconstruction is possible if the user is willing to accept dirty-tree-verified tier-6 evidence for this specific milestone (as K7 already did for its "corroborated-Medium" tier, and explicitly did **not** do for K7's still-blocked `definitions`/`execution` cluster) — but that acceptance would be a new, explicit exception to the standing methodology, not something this pass can authorize on its own.

## 2. Per-Package Findings

For all seven packages, the file **trees** are near-identical between `lumo-platform` and `lumo-platform-recovery` (same filenames, same directories) — the divergence is almost entirely inside shared files, not in new files. This is itself informative: this is a content-level reshaping of existing aggregates/composition roots, not a bolt-on module.

### Checkout

- **Diff stat:** 23 files changed, 1031 insertions / 1493 deletions. Every application/domain/infrastructure file touched; `checkout-orchestration.use-cases.ts` (441 lines), `checkout-session.ts` (333), `checkout-session.mapper.ts` (255) are the largest.
- **Content sample verified:** `domain/checkout-session.ts`'s `OrderDraft`/`PaymentIntentRequest` interfaces were redefined (shape changed, not just extended), `CheckoutSessionProps` gained nullable fields, `CheckoutSession.start()` changed its signature to a params object with new validation (`BusinessRuleError` for missing customer/session owner), and the class docstring was rewritten to explicitly describe orchestration-boundary language matching ADR-0012's vocabulary.
- **New symbols:** `ValidateCheckout`, `GenerateOrderDraft`, `GeneratePaymentIntentRequest`, `CompleteCheckout`, `FailCheckout` (all wired into `WiredCheckout.activities`), plus a `prisma` branch in `CheckoutWiringDeps` that didn't exist before.
- **Confidence: Medium.** `composition.ts`'s own docstrings self-cite "Integration Sprint — this context had NO prisma branch at all until now" and "Integration Sprint, Phase 1" for the five cross-context ports (`pricing`/`inventory`/`tax`/`shipping`/`promotion`). No ADR/Sprint Report names `ValidateCheckout` etc. directly; ADR-0012 corroborates the _concept_ only.

### Catalog

- **Diff stat:** file tree identical except `lumo-platform` additionally has `infrastructure/prisma-catalog-repositories.integration.test.ts` (recovery lacks this test file). Every domain/application file has moderate-to-large diffs (`product.ts` 471 lines, `product.test.ts` 339, `catalog.mappers.ts` 207).
- **New symbol:** `GetProduct` — the underlying file `application/get-product.use-case.ts` **already exists, byte-similar, in recovery's committed tree**; the gap is narrower than the other six packages: recovery's `index.ts` simply doesn't export `GetProduct`/`GetProductInput`, and recovery's `index.ts` additionally exports `CollectionStatus`/`PublishStateValue` that `lumo-platform`'s doesn't (a minor divergence, possibly a regression or a not-yet-re-exported type — flagged, not resolved).
- **Confidence: Medium-High for the gap itself** (small, mechanical — one export line plus composition wiring) but **the docstring does not self-cite "Integration Sprint"** verbatim; it says "for cross-context consumers (e.g. the purchase saga's quote)," which is circumstantial, not a named-source citation. The bulk of catalog's _other_ diff (product.ts 471 lines etc.) looks like a separate, larger evolution of catalog's own domain model not obviously tied to the saga at all — **not further investigated in this pass, flagged as Unknown** (see §5).

### Payments

- **Diff stat:** 20 files changed, 712 insertions / 1080 deletions. File tree identical to recovery. `payment-lifecycle.use-cases.ts` (351 lines) and `payment-intent.ts` (403 lines) are the largest.
- **New symbols:** `CapturePayment`, `CreatePaymentIntent`, `FailPayment`, `GetPaymentIntent`, `RefundPayment`, wired into `WiredPayments.activities`, plus the same "no prisma branch until now" `composition.ts` self-citation seen in Checkout/Cart.
- **Confidence: Medium.** Same self-citation pattern, same absence of any ADR/Sprint Report naming these five class names specifically. `ARCHITECTURE_REMEDIATION_PLAN.md`'s PAY-1 through PAY-6 findings (already committed) independently corroborate that `CapturePaymentLifecycle`/webhook verification/PSP adapter code already exists in this exact shape and already has known bugs — real corroboration of scope, not of exact signatures.

### Orders

- **Diff stat:** 23 files changed, 895 insertions / 1263 deletions. One file, `domain/value-objects/order-totals-snapshot.ts`, exists **only in recovery** — `lumo-platform` inlines the same `OrderTotalsSnapshot` interface directly into `domain/order.ts` (verified by reading both; the type definition is byte-similar, just relocated). This is a deliberate consolidation, not a functionality loss.
- **New symbols:** `AdvanceOrder`, `CreateOrderFromCheckout` (`WiredOrders.activities`), `GetOrder` (`WiredOrders.queries`). `order-lifecycle.use-cases.ts`'s docstring explicitly notes `AdvanceOrder` must handle the checkout-driven lifecycle (`created`→`awaiting_payment`→`payment_received`) distinctly from the legacy `placed` path `markOrderPaid` expects.
- **Confidence: Medium-High for scope/existence, Low for exact signature.** `ARCHITECTURE_EXECUTION_MATRIX.md`/`IMPLEMENTATION_DEPENDENCY_GRAPH.md` (already committed) name `AdvanceOrder`, `order-lifecycle.use-cases.ts`, and `payment-captured.consumer.ts` explicitly as existing, audited files with numbered findings (A1-i/A1-ii/A1-iii) planning fixes on top of them — the strongest external corroboration found for any single symbol in this pass. `domain/events/order-transitioned.event.ts` self-cites "Integration Sprint — Fulfillment leg" and "Integration Sprint — Finance leg" for its new line-snapshot and net/tax fields.

### Notifications

- **Diff stat:** 27 files changed, 848 insertions / 1122 deletions. File tree identical to recovery.
- **New symbol:** `CreateNotification`, wired into `WiredNotifications.activities`. `apps/runtime/src/notifications/shipment-shipped.consumer.ts` self-cites "Customer Purchase Flow (Integration Sprint — Shipping→Notifications leg, architecture correction 2026-07-26)."
- **Confidence: Medium**, same class as Checkout/Payments — self-cited by name and date, no external ADR/Sprint Report names `CreateNotification` specifically.

### Finance

- **Diff stat: by far the largest** — 133 files changed, 8207 insertions / 4186 deletions. This package shows **two distinct, separately-evidenced clusters**, confirming the task's own hint:
  1. **A structural reorg cluster** — recovery's `domain/services/*.ts` (11 files) and one-concept-per-file `read-models/*.ts` (11 files) become `lumo-platform`'s top-level `services/*.ts` (peer to `domain/`, promoted out of it) and consolidated multi-concept `read-models/*.ts` (e.g. `cashflow-cogs-inventory.ts` merges what were three separate files). **This cluster self-cites as "Finance domain services (M2)"** (`services/index.ts` header comment) — a _different_ name/tag than "Integration Sprint," and not evidenced by any `D-0xx`/ADR found in this pass. **Confidence: Unknown** — real, coherent, internally consistent, but its origin tag ("M2") doesn't match any named sprint/decision found in `docs/`.
  2. **The Integration-Sprint-cited cluster** — `OrderPaymentReceivedConsumer`/`OrderPaymentReceivedPayload` (`interfaces/order-payment-received.consumer.ts`, self-cited "Customer Purchase Flow (Integration Sprint — Finance leg)"), `post-order-paid-journal.use-case.ts` (self-cited "Integration Sprint — Finance leg"), and `events/inbound-contracts.ts`'s default account refs (same citation). **Confidence: Medium**, same basis as the other packages' Integration Sprint symbols.
  3. **The `ShippingRateCard`/`shipping-rate.ts`/`QuoteShippingRates` cluster** — genuinely separate again: `quote-shipping-rates.use-case.ts`'s own docstring says "Finance owns the money (mirrors `CalculateTax`)... See the Integration Sprint decision recorded alongside `CalculateTax`" — so this cluster **is** Integration-Sprint-tagged, contrary to a naive read of the original hint that it "is likely separately evidenced." **Confidence: Medium**, same basis, not High — no DECISIONS.md/ADR entry for shipping-rate-card was found despite a direct search.
  4. `WiredFinance` gains both `.queries` (`calculateTax`, `quoteShippingRates`) and `.activities` (`postOrderPaidJournal`), plus a `prisma` field on `FinanceWiringDeps` that didn't exist before.

### Fulfillment

- **Diff stat:** 28 files changed, 912 insertions / 1189 deletions. Two files exist **only in recovery** — `application/create-shipment.use-case.ts` and `application/request-reservation.use-case.ts`. **This is not a functionality loss**: verified directly that `lumo-platform`'s `composition.ts` still imports and wires `CreateShipment`/`RequestReservation`, now consolidated inside `application/fulfillment-lifecycle.use-cases.ts` (the same file-consolidation pattern seen in Payments'/Orders'/Notifications' `*-lifecycle.use-cases.ts` files — a consistent structural signature across the whole reshaping).
- **New symbols:** `CreateFulfillment` (already present as a class, but reshaped), `FulfillmentEventTranslator`, `InMemoryNotificationPort`, `OrderPaymentReceivedConsumer`, `OrderPaymentReceivedPayload`.
- `domain/value-objects/fulfillment-refs.ts` and `composition.ts` both self-cite, verbatim, "**Integration Sprint architecture correction, 2026-07-26** — Shipping owns all carrier integration; Fulfillment only requests a shipment" — the single most specific, dated, cross-file-consistent citation found in this entire investigation.
- **Confidence: Medium-High** for the architecture-correction narrative specifically (repeated verbatim across 3+ files with the same date), **Medium** for the exact new symbol signatures.

## 3. Recommended Milestone Structure

Structurally, the seven packages **do not import each other's new symbols directly** — `no-cross-service-internals` (dependency-cruiser) is respected throughout; every cross-context call is mediated by a locally-defined port interface implemented by an adapter that lives in `apps/admin/src/infrastructure/cross-context-ports.ts` or `apps/runtime/src/composition.ts`. This means, unlike Customer-360's single shared `composition.ts`, the twelve service-level packages could in principle be committed independently of each other. However all twelve share one self-cited name, one date for the one explicit architectural correction, and one composition idiom — there is no evidence any of them happened as an isolated, separately-motivated change, and `apps/admin`/`apps/runtime`'s composition roots each wire all of them together in one file. Following this recovery's Customer-360 precedent (one commit per named cluster, not split to sub-sprint granularity, since inventing an intermediate state that never existed is fabrication, not reconstruction), the same reasoning applies here.

**If this milestone is ever executed, the recommended structure is two commits, in this order:**

1. **"Integration Sprint — cross-context composition surface"**: the twelve packages' new `application`-layer symbols and `composition.ts`/`index.ts` changes (Checkout, Catalog's `GetProduct` export, Payments, Orders, Notifications, Finance, Fulfillment, plus Promotions, Coupons, Cart, Pricing, Inventory — see §4). No dependency ordering required within this commit since none of these packages import each other; it is one commit because there is no evidenced intermediate state.
2. **"Integration Sprint — app-layer wiring"**: `apps/admin/src/infrastructure/cross-context-ports.ts`, `apps/admin/src/composition.ts`, `apps/runtime/src/composition.ts`'s new Fulfillment/Finance/Shipping→Notifications slices — depends on (1).

**Explicitly excluded from either commit**, per `RUNTIME_R2_INVESTIGATION_REPORT.md`'s finding: `apps/runtime/src/purchase-saga-activities.ts`, `purchase/purchase-saga-routes.ts`, and `apps/runtime/src/modules/purchase-saga.module.ts`. These are pieces `ARCHITECTURE_REMEDIATION_PLAN.md` itself documents as already-buggy (SAGA-1 through SAGA-11) — committing them as-is would mean committing known-defective code under the guise of history reconstruction, a separate decision from the composition-surface question this report answers.

## 4. Packages Outside the Original Seven Also Touched

Direct grep for the literal string "Integration Sprint" and independent verification against each package's currently-committed `composition.ts` found:

- **`@platform/promotions`** — recovery's committed `WiredPromotions` has only `{ promotions, drainOutbox, deliveredEventTypes }`; `lumo-platform`'s adds a `.queries: { checkPromotionActive, evaluatePromotion }` field. Every other package's new `.activities`/`.queries` docstring cites `WiredPromotions.queries`'s own doc comment as the canonical precedent for the pattern — meaning Promotions was either the _first_ package reshaped in this effort, or reshaped concurrently and treated internally as the reference implementation.
- **`@platform/coupons`** — `composition.ts` self-cites "Real cross-context adapter for `PromotionsPort` (Integration Sprint, Phase 1)."
- **`@platform/cart`** — `composition.ts` self-cites "Production persistence (Integration Sprint — this context had NO prisma branch at all until now)" — identical phrasing to Checkout/Payments.
- **`@platform/pricing`** — `infrastructure/prisma-pricing-repositories.ts` gains a `findByProduct` read method, self-cited "Cross-context validation read (Integration Sprint, Phase 1)." Read-only, no new `Wired*` shape change found.
- **`@platform/inventory`** — same pattern, `prisma-inventory-item-repository.ts`'s `findByProduct`, "Integration Sprint, Phase 1."

None of these five was in the original scope of this investigation; all five should be folded into recommended-commit-#1 in §3 if this milestone is executed, since `apps/admin`/`apps/runtime`'s wiring changes reference them too.

## 5. Explicit List of What Remains Unknown/Unevidenced

- **No primary planning document for "Integration Sprint" exists anywhere** — confirmed by both literal-string grep and filename glob (`*INTEGRATION*`) across all of `lumo-platform`, including its ~30 root-level `V4`/`V5` recovery-planning documents. The name is real (self-cited consistently, with a specific date, across 29 files in 12+ packages) but is tier-6 evidence only, per the recovery's own methodology — never a valid implementation source without an explicit user exception.
- **Exact signatures of every new class are unevidenced beyond the dirty tree itself.** ADR-0012/D-050/the already-committed audit docs corroborate _that_ this surface exists and roughly _what_ it does, never the literal method/field names to type-for-type accuracy.
- **Catalog's non-`GetProduct` diff** (`product.ts` 471 lines, `product.test.ts` 339 lines, etc.) was not attributed to any source in this pass — it may be an unrelated, larger catalog-domain evolution never investigated for a citation. Flagged, not resolved.
- **Finance's "M2" domain-services/read-model reorg** has its own self-citation tag distinct from "Integration Sprint," and no `D-0xx`/ADR/Sprint Report matching "M2" was found in this pass despite a direct search of `docs/DECISIONS.md`.
- **Finance's `ShippingRateCard`/`shipping-rate.ts` domain files** have no `DECISIONS.md`/ADR citation at all (checked directly) — only the use-case docstring's informal cross-reference to `CalculateTax`.
- **Catalog's `index.ts` divergence** (recovery additionally exports `CollectionStatus`/`PublishStateValue` that `lumo-platform` doesn't) — unexplained, possibly an unrelated regression in the dirty tree, not investigated further.
- **Whether Promotions was the origin or a co-evolved peer** of the `.activities`/`.queries` pattern is not resolvable from anything on disk — only inferable from citation direction (everyone else points at Promotions; nothing points away from it).

## 6. Bottom-Line Recommendation

**Do not attempt reconstruction as a normal commit under the standing methodology as-is.** The evidence-sourcing precedence (`RECOVERY_IMPLEMENTATION_METHODOLOGY.md`) requires sources 1-5 to be exhausted before the dirty tree is even consulted, and for this cluster sources 1-5 are essentially silent: no Recovery Plan entry, no Sprint Report, no ADR names any of the new symbols. Proceeding past that gate here without an explicit exception would repeat, at a much larger scale (12+ packages instead of one file), the exact mistake the Evidence Closure Rule was written to prevent.

That said, this is meaningfully **more ready than K7's still-blocked `definitions`/`execution` cluster**: the self-citation is dated, internally consistent, cites a real architectural correction independently verifiable in the code, and is corroborated in scope (though not exact signature) by three already-committed planning/audit documents.

**Recommended path, pending an explicit user decision:**

1. Treat "accept tier-6 (dirty-tree self-citation) evidence for this specific milestone" as a named, explicit, one-time exception — the same kind of decision K7's own remaining gap asked for and did not receive.
2. If authorized: reconstruct commit #1 (§3) first (the twelve packages' new application-layer surface), verified byte-for-byte against `lumo-platform`, with a milestone report stating the tier-6 exception explicitly rather than silently upgrading confidence. Commit #2 (app-layer wiring) follows.
3. **Do not reconstruct `purchase-saga-activities.ts`/`purchase-saga-routes.ts` itself** even if (2) is authorized — `ARCHITECTURE_REMEDIATION_PLAN.md`'s own SAGA-1 through SAGA-11 findings document that file as currently defective. That is a separate decision from the composition-surface question this report answers.
