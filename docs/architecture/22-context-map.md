# 22 — Context map (strategic DDD)

> **Status: CONTRACT — 2026-07-04 (ADR-gated per D-017).** The strategic map of the Phase-1
> bounded contexts: who owns what, how contexts relate, and where the anti-corruption points
> are. Complements the tactical rules in doc 03 and the event ownership in doc 20 §1.1.

## 1. Contexts and ownership

| Context                    | Owns (aggregates)                                      | Owns (published language)                       | Team-scale note                                                                  |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| **Catalog**                | Product (+Variant), Category                           | `catalog.product.*` events; product/variant ids | The upstream context most others reference                                       |
| **Media**                  | Asset                                                  | `media.asset.*` events; storage keys            | Supporting                                                                       |
| **Pricing**                | Price, PriceList                                       | `pricing.price.*` events                        | Owns the _only_ legitimate origin of a price (ADR-0004 follow-up rule)           |
| **Inventory**              | InventoryItem (+Reservation)                           | `inventory.inventory_item.*` events             | Hot path at scale — see gap register G-7                                         |
| **Cart**                   | Cart (+CartItem)                                       | `cart.cart.*` events                            | Redis-backed live storage planned (doc 15)                                       |
| **Checkout**               | CheckoutSession                                        | `checkout.checkout_session.*` events            | Fronts the purchase saga (Temporal, Phase 2)                                     |
| **Orders**                 | Order (+OrderItem, OrderEvent)                         | `orders.order.*` events                         | Append-only order history; financial record                                      |
| **Payments**               | PaymentIntent (+Charge, Refund)                        | `payments.payment_intent.*` events              | PSP port design pending (saga design doc)                                        |
| **Identity**               | Customer (+Address, ConsentRecord)                     | `identity.customer.*` events                    | Customer profiles + consent; authn is Ory's job                                  |
| _(future)_ **Tenancy**     | Tenant, Organization                                   | tenant ids (ADR-0008)                           | Upstream of everything once multi-merchant                                       |
| _(future)_ **Apps**        | AppInstallation (per-tenant grants, manifest versions) | `apps.*` events; OAuth scopes (doc 24)          | Owns third-party install state; apps themselves run out-of-process (ADR-0010)    |
| _(future)_ **Theming**     | Theme (versions, draft/preview/live pointers)          | theme manifests (doc 25)                        | Themes are data; rendering is a platform tier, not a context                     |
| _(future)_ **Fulfillment** | FulfillmentOrder, Return, Exchange                     | `fulfillment.*` events                          | Downstream of Orders (G-35); Orders' placed→paid→refunded lifecycle stays closed |
| _(future)_ **Companies**   | Company, CompanyContact (B2B)                          | company refs; negotiated PriceList refs         | B2B is not a bent Customer (G-37)                                                |

`apps/admin` is a **composition root / BFF**, not a context (D-033). `services/example` is the
walking skeleton, not business.

## 2. Relationships

- **Published language (event contracts):** all cross-context async coupling goes through the
  integration events in doc 20 §1.1 — no context imports another's types (lint-enforced).
- **Shared kernel (deliberately tiny):** `Money`, `ProductRef` in `@platform/domain` (D-030).
  Anything else must pass the rule of three (D-029).
- **Customer/Supplier — Catalog upstream:** Pricing, Inventory, Cart, Orders reference products
  only by `ProductRef` (bare id). Orders additionally **conforms via snapshot** (`ProductSnapshot`,
  `AddressSnapshot`): order lines are immutable copies, insulating the financial record from
  catalog changes — this is the anti-corruption point for order history.
- **Checkout as (future) orchestrator:** the purchase saga (Checkout → Pricing → Inventory →
  Payments → Orders, compensation on failure) is Temporal-orchestrated in Phase 2. Rule fixed
  now: **`orders.order.paid` may only be caused by `payments.payment_intent.captured`** — payment
  truth is never caller-asserted (hardening review P0-2).
- **Identity is upstream of personalization/marketing** (consent gates tracking, doc 16) and
  deliberately _not_ an authentication provider — Ory adapters implement the
  `Authenticator`/`Principal` contracts.
- **Translators are the ACL:** each context's `*-event-translator.ts` is the boundary where the
  domain model is deliberately decoupled from the wire contract (and where PII minimization is
  enforced, ADR-0006).

## 3. Rules for changing this map

Adding a context, moving an aggregate between contexts, or adding a new cross-context
relationship requires an ADR (D-017). New events must land in doc 20 §1.1 with a 3-segment name
in the same change that implements the translator (ADR-0004).
