# 07 — Commerce Modules specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Specification for independent commerce
> modules. Each module is its own bounded context or a clean extension of one
> ([arch 03 — domain and database boundaries](../architecture/03-domain-and-database-boundaries.md)):
> data is owned exclusively, communication is via events ([arch 05](../architecture/05-events-queues-workers-and-jobs.md)/
> [arch 20](../architecture/20-events-catalog.md)), there are **no cross-context FKs**, and every module
> is flaggable ([growth 06](06-FEATURE_MANAGEMENT_SPEC.md)) and extensible via the plugin system
> ([arch 11](../architecture/11-integration-and-plugins.md)). No application code; DB ownership is
> logical (a context/schema), not DDL.
>
> **Design system note:** modules with an existing screen surface there; modules without one are
> **net-new admin surfaces that require approval** ([`../ui/`](../ui/README.md)). This spec defines
> capability, not UI.

## 1. Cross-cutting compliance baseline (every module)

| Concern                | Requirement                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking               | Module interactions emit standardized events ([arch 16](../architecture/16-tracking-specification.md))                                    |
| Analytics              | All module events flow to ClickHouse; reporting via the **Analytics** screen ([arch 10](../architecture/10-analytics-and-feed-engine.md)) |
| Audit logs             | Mutations → `audit.entry.recorded` (WORM)                                                                                                 |
| Permissions            | RBAC+ReBAC ([arch 07](../architecture/07-auth-and-authorization.md)); per-module roles in §3                                              |
| Feature flags          | Each module + sub-feature is flaggable with a kill switch                                                                                 |
| Dark mode / Responsive | Any operator surface uses frozen tokens + responsive rules ([`../ui/`](../ui/README.md))                                                  |
| Localization           | Customer-facing copy i18n-keyed; currency/timezone-aware                                                                                  |
| Accessibility          | Customer + operator surfaces WCAG 2.2 AA                                                                                                  |
| Version history        | Module configuration (rules, templates) versioned with rollback                                                                           |
| Child-safety           | No module profiles minors or uses child data for targeting/marketing ([arch 14](../architecture/14-security.md))                          |

**Analytics** for all modules = derived from their tracking events in ClickHouse; not repeated per module below.

## 2. Module catalog

Columns: Business rules · Tracking events ([arch 16](../architecture/16-tracking-specification.md)) · DB ownership (context) · Dependencies · Extension points.

### 2.1 Engagement & UGC

| Module              | Business rules                                                 | Tracking events                                              | DB ownership          | Dependencies                 | Extension points              |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- | ---------------------------- | ----------------------------- |
| Wishlist            | Per-customer lists; public/shared; gift registry; purchased-by | `product_added_to_wishlist`, `product_removed_from_wishlist` | `social`              | Catalog, Identity            | share targets, registry types |
| Reviews             | Verified-purchase flag; moderation; media; helpful votes       | review submit (custom), `product_viewed`                     | `social.reviews`      | Orders (verification), Media | moderation hooks, syndication |
| Ratings             | Aggregate stars; per-dimension; recompute on review change     | —                                                            | `social` (read model) | Reviews                      | rating dimensions             |
| Questions & Answers | Customer Q + staff/community A; moderation                     | Q&A submit (custom)                                          | `social`              | Catalog                      | AI auto-answer, moderation    |

### 2.2 Growth & loyalty

| Module            | Business rules                                             | Tracking events                              | DB ownership                      | Dependencies                    | Extension points            |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------- | --------------------------------- | ------------------------------- | --------------------------- |
| Referral Program  | Referrer reward + referee offer; fraud checks; attribution | `offer_claimed`, `account_created`           | `marketing`/`loyalty`             | Identity, Pricing, Attribution  | reward types                |
| Loyalty Program   | Points ledger (append-only); tiers; earn/burn; expiry      | loyalty earn/burn (custom)                   | `loyalty`                         | Orders, Identity                | earn rules, tier benefits   |
| Gift Cards        | Issuance; balance ledger; redemption; expiry; fraud        | gift card issue/redeem (custom)              | `payments`/store-credit           | Payments, Orders                | designs, delivery channels  |
| Affiliate Program | Affiliate accounts; links; commission; payouts             | `offer_claimed`, conversion                  | `marketing`/affiliate             | Attribution, Identity, Finance  | commission models, networks |
| Subscriptions     | Recurring orders; cycles; dunning; pause/skip/cancel       | `subscription_started`, `purchase_completed` | `orders`/subscriptions + Temporal | Payments, Orders, Notifications | plan types, intervals       |
| Membership        | Paid/free tiers; gated benefits/pricing                    | membership events (custom)                   | `identity`/membership             | Identity, Pricing               | benefit types               |
| Rewards           | Redeemable reward catalog (burns loyalty points)           | reward redeem (custom)                       | `loyalty`                         | Loyalty                         | reward catalog              |
| Store Credit      | Credit ledger; issuance (returns/goodwill); redemption     | credit issue/redeem (custom)                 | `payments`/store-credit           | Orders, Returns                 | issuance reasons            |

### 2.3 Discovery & communication

| Module              | Business rules                                                                   | Tracking events                                                                           | DB ownership                             | Dependencies             | Extension points            |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------ | --------------------------- |
| Advanced Search     | Faceted (age/outcome) + typo tolerance + synonyms + semantic                     | `search_submitted`, `search_results_viewed`, `search_result_clicked`, `search_no_results` | OpenSearch index + pgvector (read model) | Catalog, Recommendations | ranking signals, synonyms   |
| Notifications       | Transactional + system across channels; preferences                              | delivery events (custom)                                                                  | `notifications`                          | Identity, Orders         | channel adapters, templates |
| Email Automation    | Lifecycle flows; consent-gated ([arch 08](../architecture/08-marketing-core.md)) | `email_opened`, `email_clicked`                                                           | `marketing`                              | Marketing, Tracking      | triggers, steps, channels   |
| WhatsApp Automation | WA flows; approved templates only                                                | `whatsapp_message_delivered`, `_read`                                                     | `marketing`                              | Marketing, WA provider   | templates, triggers         |

### 2.4 Integrations

| Module          | Business rules                                                        | Tracking events      | DB ownership    | Dependencies                                                                                | Extension points             |
| --------------- | --------------------------------------------------------------------- | -------------------- | --------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| CRM Integration | Sync customers/segments/events to CRM; field mapping; conflict policy | sync events (custom) | connector state | Identity, Marketing, Integration ([arch 11](../architecture/11-integration-and-plugins.md)) | connector adapters, mapping  |
| ERP Integration | Sync products/inventory/orders/finance; sync schedule; reconciliation | sync events (custom) | connector state | Catalog, Inventory, Orders                                                                  | adapters, mapping, schedules |

### 2.5 Fulfillment & operations

| Module              | Business rules                                          | Tracking events                 | DB ownership             | Dependencies                | Extension points                  |
| ------------------- | ------------------------------------------------------- | ------------------------------- | ------------------------ | --------------------------- | --------------------------------- |
| Multi Warehouse     | Multiple stock locations; fulfillment routing; priority | `inventory.stock.*` (domain)    | `inventory` (warehouses) | Inventory, Orders           | routing strategies                |
| Inventory Transfers | Move stock between warehouses; in-transit tracking      | transfer events (domain)        | `inventory` (movements)  | Inventory                   | transfer workflows                |
| Returns             | RMA; reasons; inspection; restock; refund/credit        | `order_refunded`, return events | `orders` (returns)       | Orders, Payments, Inventory | return policies, inspection hooks |
| Exchanges           | Return + replacement order; price-difference handling   | exchange events                 | `orders`                 | Returns, Orders, Payments   | exchange rules                    |

## 3. Permissions (per module group)

| Role         | Modules                                                             |
| ------------ | ------------------------------------------------------------------- |
| Finance      | Gift Cards, Store Credit, Affiliate payouts, Subscriptions billing  |
| CS agent     | Returns, Exchanges, Store Credit issuance (goodwill), order notes   |
| Merchandiser | Reviews/Q&A moderation, Advanced Search config, Wishlist insights   |
| Marketer     | Loyalty, Referral, Affiliate, Membership, Email/WhatsApp automation |
| Admin        | CRM/ERP integrations, module enable/disable                         |

All gated by RBAC+ReBAC ([arch 07](../architecture/07-auth-and-authorization.md)); sensitive financial actions require step-up.

## 4. Module independence principles

- Each module owns its data and exposes it only via API/events; **no cross-context joins or FKs**.
- Modules communicate by domain events ([arch 20](../architecture/20-events-catalog.md)); a module can be enabled/disabled via flags without breaking others.
- Extension points are realized through the plugin system ([arch 11](../architecture/11-integration-and-plugins.md)) with declared scopes.

## 5. Frozen-UI surface mapping

| Existing screen                     | Modules                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviews                             | Reviews, Ratings, Q&A (moderation)                                                                                                             |
| Email / WhatsApp / Automations      | Email & WhatsApp automation                                                                                                                    |
| Inventory                           | Multi Warehouse, Inventory Transfers                                                                                                           |
| Orders                              | Returns, Exchanges                                                                                                                             |
| Customers                           | Wishlist insights                                                                                                                              |
| **New surface — requires approval** | Loyalty, Gift Cards, Affiliate, Subscriptions, Membership, Rewards, Store Credit, Referral, Advanced Search admin, CRM/ERP integration screens |

## Requires ADR to change

- The module independence rules (data ownership, no cross-context FK, event communication).
- A module's bounded-context/DB ownership, its dependency set, or its extension-point contract.
- Adding a module, or any module that introduces a new admin surface (also requires UI approval).
