# 20 — Events catalog

> **Status: CONTRACT — 2026-06-28.** The complete catalog of **domain / system events** on the
> event backbone (Redpanda topics), complementing [05 — event-driven architecture](05-events-queues-workers-and-jobs.md).
> These are _inter-service_ events (not the analytics clickstream — that is [16](16-tracking-specification.md);
> the bridge event is `tracking.event.captured`). Payload schemas are field lists, not DDL/code.

## 1. Conventions (apply to all)

- **Topic name:** `<context>.<aggregate>.<event>.v<version>` (past tense). Partition key = aggregate id.
- **Delivery:** at-least-once via transactional outbox + Debezium; **consumers are idempotent** (keyed by event id). Every consumer has a DLQ + alert.
- **Priority:** `critical` (revenue/safety, lowest lag tolerance) · `high` · `normal` · `low`.
- **Retry policy keys:** `std` = exponential backoff + jitter, 5 attempts, then DLQ; `extended` = 8 attempts over hours (external integrations); `none` = best-effort, no DLQ (analytics-grade).
- **Retention keys:** `compacted` (keep latest per key) · `30d` · `13mo` (tracking/attribution replay) · `7y-archive` (financial/audit → object storage). Defaults: business events `30d`, plus CDC-fed read models.
- Every event carries the standard headers: `event_id`, `occurred_at`, `producer`, `trace_id`, `schema_version`, `tenant`/`household` where relevant. _(Implemented today: `messageId`, `type`, `eventVersion`, `contentType`, `correlationId`, `causationId`, plus `producer`/`tenantId` when present — ADR-0004. `trace_id` lands with OTel propagation in the broker sprint.)_

## 1.1 Implemented events — reconciliation (ADR-0004)

> **This table is the source of truth for the Phase-1 topics that exist in code.** Event names are
> canonically **3 segments** (`<context>.<aggregate>.<event>`, enforced by `topicFor`); rows
> elsewhere in this catalog that use older 2-segment shorthand (e.g. `cart.abandoned.v1`) or
> divergent names (e.g. `inventory.stock.adjusted.v1`, `payments.payment.captured.v1`) are
> **superseded** by the names below and will be normalized when their sections are next revised.

| Implemented topic                        | Producer  | Raised by                                                                 |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------- |
| `catalog.product.published.v1`           | catalog   | `Product.publish`                                                         |
| `catalog.product.updated.v1`             | catalog   | `Product.update`                                                          |
| `media.asset.ready.v1`                   | media     | `Asset` ready transition                                                  |
| `pricing.price.changed.v1`               | pricing   | `Price.change`                                                            |
| `inventory.inventory_item.adjusted.v1`   | inventory | every `InventoryItem` quantity change (reason field)                      |
| `cart.cart.checked_out.v1`               | cart      | `Cart.checkOut`                                                           |
| `cart.cart.abandoned.v1`                 | cart      | `Cart.abandon`                                                            |
| `checkout.checkout_session.completed.v1` | checkout  | `CheckoutSession.complete`                                                |
| `checkout.checkout_session.failed.v1`    | checkout  | `CheckoutSession.fail`                                                    |
| `orders.order.placed.v1`                 | orders    | `Order.place`                                                             |
| `orders.order.paid.v1`                   | orders    | `Order.markPaid`                                                          |
| `orders.order.refunded.v1`               | orders    | `Order.refund`                                                            |
| `payments.payment_intent.captured.v1`    | payments  | `PaymentIntent.capture`                                                   |
| `payments.payment_intent.failed.v1`      | payments  | `PaymentIntent.fail`                                                      |
| `payments.payment_intent.refunded.v1`    | payments  | `PaymentIntent.refund`                                                    |
| `identity.customer.registered.v1`        | identity  | `Customer.register` — payload is `{ customerId }` only (no PII, ADR-0006) |
| `identity.customer.consent_changed.v1`   | identity  | `Customer.changeConsent`                                                  |

## 2. Authentication

| Event                         | Description           | Payload (key fields)                    | Producer | Consumers            | Priority | Retry | Retention  |
| ----------------------------- | --------------------- | --------------------------------------- | -------- | -------------------- | -------- | ----- | ---------- |
| `identity.session.started.v1` | Login succeeded       | session_id, customer_id, method, device | Identity | Analytics, Marketing | high     | std   | 13mo       |
| `identity.session.ended.v1`   | Logout/expiry         | session_id, reason                      | Identity | Analytics            | normal   | none  | 30d        |
| `identity.mfa.challenged.v1`  | Step-up issued        | customer_id, factor, result             | Identity | Security/Audit       | high     | std   | 7y-archive |
| `identity.token.issued.v1`    | Access/refresh issued | subject, aud, exp                       | Identity | Audit                | normal   | none  | 30d        |
| `identity.token.revoked.v1`   | Token revoked         | subject, reason                         | Identity | Gateway, Audit       | critical | std   | 7y-archive |

## 3. Permissions

| Event                                 | Description                           | Payload                                           | Producer | Consumers          | Priority | Retry | Retention  |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------- | -------- | ------------------ | -------- | ----- | ---------- |
| `identity.role.assigned.v1`           | Role granted                          | user_id, role, granted_by, expires_at             | Identity | Authz cache, Audit | high     | std   | 7y-archive |
| `identity.role.revoked.v1`            | Role removed                          | user_id, role                                     | Identity | Authz cache, Audit | critical | std   | 7y-archive |
| `identity.permission.decision.v1`     | Authz decision (deny/grant) for audit | subject, object, action, decision, policy_version | Authz    | Audit              | normal   | none  | 7y-archive |
| `identity.access_review.completed.v1` | Quarterly review done                 | scope, reviewer, findings                         | Identity | Audit              | low      | none  | 7y-archive |

## 4. Storefront / customer

| Event                             | Description                                    | Payload                           | Producer           | Consumers                                    | Priority | Retry | Retention  |
| --------------------------------- | ---------------------------------------------- | --------------------------------- | ------------------ | -------------------------------------------- | -------- | ----- | ---------- |
| `identity.customer.registered.v1` | New account                                    | customer_id, household_id, source | Identity           | Marketing, Analytics, Loyalty                | high     | std   | 13mo       |
| `identity.consent.changed.v1`     | Consent update                                 | customer_id, categories           | Identity           | Tracking, Marketing, Audit                   | critical | std   | 7y-archive |
| `cart.item_added.v1`              | Item added to cart                             | cart_id, item_id, qty, price      | Cart               | Inventory(reserve), Marketing, Analytics     | high     | std   | 30d        |
| `cart.item_removed.v1`            | Item removed                                   | cart_id, item_id                  | Cart               | Inventory(release), Analytics                | normal   | std   | 30d        |
| `cart.abandoned.v1`               | Cart inactivity threshold                      | cart_id, customer_id?, value      | Cart               | Automation (recovery), Analytics             | high     | std   | 30d        |
| `wishlist.item_added.v1`          | Wishlist add                                   | wishlist_id, item_id, customer_id | Reviews/Social     | Marketing, Analytics                         | low      | none  | 30d        |
| `tracking.event.captured.v1`      | A validated clickstream event (bridge to [16]) | full tracking envelope            | Tracking collector | Analytics, Attribution, Conversion forwarder | high     | none  | 13mo       |

## 5. Inventory

| Event                              | Description          | Payload                                         | Producer  | Consumers                         | Priority | Retry | Retention |
| ---------------------------------- | -------------------- | ----------------------------------------------- | --------- | --------------------------------- | -------- | ----- | --------- |
| `inventory.stock.reserved.v1`      | Reservation created  | item_id, warehouse_id, qty, cart_id, expires_at | Inventory | Cart/Checkout                     | critical | std   | 30d       |
| `inventory.stock.released.v1`      | Reservation released | reservation_id, reason                          | Inventory | Cart                              | high     | std   | 30d       |
| `inventory.reservation.expired.v1` | TTL expiry           | reservation_id                                  | Inventory | Cart, Analytics                   | high     | std   | 30d       |
| `inventory.stock.adjusted.v1`      | On-hand change       | item_id, delta, reason                          | Inventory | Feed engine, Search, Analytics    | high     | std   | 30d       |
| `inventory.stock.low.v1`           | Below reorder point  | item_id, on_hand                                | Inventory | Feed engine, Notifications, Admin | normal   | std   | 30d       |
| `inventory.stock.depleted.v1`      | Hit zero             | item_id                                         | Inventory | Feed engine (delta), Search       | critical | std   | 30d       |

## 6. Payments

| Event                            | Description           | Payload                               | Producer | Consumers                               | Priority | Retry    | Retention  |
| -------------------------------- | --------------------- | ------------------------------------- | -------- | --------------------------------------- | -------- | -------- | ---------- |
| `payments.intent.created.v1`     | Payment intent opened | intent_id, order_id, amount, currency | Payments | Checkout (saga)                         | high     | std      | 7y-archive |
| `payments.payment.authorized.v1` | Auth ok               | intent_id, provider_ref               | Payments | Orders (saga)                           | critical | std      | 7y-archive |
| `payments.payment.captured.v1`   | Funds captured        | payment_id, amount                    | Payments | Orders, Analytics                       | critical | std      | 7y-archive |
| `payments.payment.failed.v1`     | Auth/capture failed   | intent_id, code                       | Payments | Checkout (compensate), Analytics        | critical | std      | 7y-archive |
| `payments.refund.issued.v1`      | Refund processed      | payment_id, amount                    | Payments | Orders, Analytics(net rev), Attribution | critical | std      | 7y-archive |
| `payments.webhook.received.v1`   | PSP webhook ingested  | provider, type, ref                   | Payments | Payments (internal)                     | high     | extended | 30d        |

## 7. Orders

| Event                       | Description   | Payload                                                      | Producer | Consumers                                          | Priority | Retry | Retention  |
| --------------------------- | ------------- | ------------------------------------------------------------ | -------- | -------------------------------------------------- | -------- | ----- | ---------- |
| `orders.order.placed.v1`    | Order created | order_id, customer_id, items[], totals, attribution snapshot | Orders   | Inventory, Payments, Marketing, Analytics, Loyalty | critical | std   | 7y-archive |
| `orders.order.paid.v1`      | Order paid    | order_id                                                     | Orders   | Fulfillment, Analytics(conversion)                 | critical | std   | 7y-archive |
| `orders.order.fulfilled.v1` | Fulfilled     | order_id                                                     | Orders   | Notifications, Marketing(post-purchase)            | high     | std   | 7y-archive |
| `orders.order.cancelled.v1` | Cancelled     | order_id, reason                                             | Orders   | Inventory(release), Analytics                      | high     | std   | 7y-archive |
| `orders.order.refunded.v1`  | Refunded      | order_id, amount                                             | Orders   | Analytics, Attribution, Loyalty                    | critical | std   | 7y-archive |

## 8. Shipping

| Event                              | Description      | Payload                             | Producer | Consumers                            | Priority | Retry    | Retention  |
| ---------------------------------- | ---------------- | ----------------------------------- | -------- | ------------------------------------ | -------- | -------- | ---------- |
| `orders.shipment.created.v1`       | Shipment created | shipment_id, order_id, warehouse_id | Orders   | Notifications                        | high     | std      | 7y-archive |
| `orders.shipment.label_created.v1` | Label purchased  | shipment_id, carrier, tracking      | Orders   | Notifications                        | normal   | extended | 7y-archive |
| `orders.shipment.shipped.v1`       | Dispatched       | shipment_id, tracking               | Orders   | Notifications, Marketing, Analytics  | high     | std      | 7y-archive |
| `orders.shipment.delivered.v1`     | Delivered        | shipment_id, delivered_at           | Orders   | Marketing(review request), Analytics | normal   | std      | 7y-archive |
| `orders.shipment.returned.v1`      | Returned         | shipment_id, reason                 | Orders   | Inventory, Analytics                 | high     | std      | 7y-archive |

## 9. Marketing

| Event                               | Description             | Payload                    | Producer      | Consumers              | Priority | Retry | Retention  |
| ----------------------------------- | ----------------------- | -------------------------- | ------------- | ---------------------- | -------- | ----- | ---------- |
| `marketing.campaign.scheduled.v1`   | Campaign scheduled      | campaign_id, channel, at   | Marketing     | Automation             | normal   | std   | 30d        |
| `marketing.campaign.sent.v1`        | Campaign dispatched     | campaign_id, audience_size | Marketing     | Analytics              | high     | std   | 13mo       |
| `marketing.send.delivered.v1`       | Per-recipient delivered | send_id, recipient_hash    | Notifications | Marketing, Analytics   | normal   | none  | 13mo       |
| `marketing.send.opened.v1`          | Open                    | send_id                    | Notifications | Analytics, Attribution | low      | none  | 13mo       |
| `marketing.send.clicked.v1`         | Click                   | send_id, url               | Notifications | Analytics, Attribution | normal   | none  | 13mo       |
| `marketing.segment.updated.v1`      | Segment recomputed      | segment_id, size           | Marketing     | Reverse-ETL            | normal   | std   | 30d        |
| `marketing.consent.unsubscribed.v1` | Opt-out                 | customer_id, channel       | Marketing     | Notifications, Audit   | critical | std   | 7y-archive |

## 10. Automation

| Event                              | Description           | Payload                        | Producer              | Consumers            | Priority | Retry | Retention |
| ---------------------------------- | --------------------- | ------------------------------ | --------------------- | -------------------- | -------- | ----- | --------- |
| `automation.workflow.started.v1`   | Flow instance started | automation_id, run_id, trigger | Automation (Temporal) | Analytics            | normal   | std   | 30d       |
| `automation.step.completed.v1`     | Step done             | run_id, step                   | Automation            | Analytics            | low      | none  | 30d       |
| `automation.workflow.completed.v1` | Flow finished         | run_id, outcome                | Automation            | Analytics            | normal   | std   | 30d       |
| `automation.workflow.failed.v1`    | Flow errored          | run_id, error                  | Automation            | Observability, Admin | high     | std   | 30d       |

## 11. Analytics / attribution

| Event                                  | Description                       | Payload                        | Producer             | Consumers                | Priority | Retry    | Retention |
| -------------------------------------- | --------------------------------- | ------------------------------ | -------------------- | ------------------------ | -------- | -------- | --------- |
| `analytics.rollup.completed.v1`        | Aggregation batch done            | view, window                   | Analytics            | Admin dashboards         | low      | none     | 30d       |
| `attribution.journey.closed.v1`        | Journey closed on conversion      | journey_id, conversion_id      | Attribution          | Analytics, Marketing     | normal   | std      | 13mo      |
| `attribution.conversion.attributed.v1` | Credit computed                   | conversion_id, model, splits[] | Attribution          | Analytics, Reverse-ETL   | normal   | std      | 13mo      |
| `analytics.audience.synced.v1`         | Reverse-ETL push result           | segment_id, channel, status    | Analytics            | Marketing, Observability | normal   | extended | 30d       |
| `conversion.forwarded.v1`              | SST forward result (per platform) | dedup_id, platform, status     | Conversion forwarder | Observability, Analytics | high     | extended | 30d       |

## 12. Feed engine

| Event                          | Description                    | Payload                                   | Producer    | Consumers            | Priority | Retry    | Retention |
| ------------------------------ | ------------------------------ | ----------------------------------------- | ----------- | -------------------- | -------- | -------- | --------- |
| `feed.generation.started.v1`   | Build started                  | feed_id, channel, country                 | Feed engine | Monitoring           | low      | none     | 30d       |
| `feed.generation.completed.v1` | Snapshot built                 | feed_id, version, item_count, diagnostics | Feed engine | Sync, Monitoring     | normal   | std      | 30d       |
| `feed.sync.completed.v1`       | Channel sync ok                | feed_id, channel, pushed, version         | Feed engine | Health dashboard     | normal   | extended | 30d       |
| `feed.sync.failed.v1`          | Channel sync failed            | feed_id, channel, error                   | Feed engine | Observability, Admin | high     | extended | 30d       |
| `feed.item.disapproved.v1`     | Channel disapproval reconciled | feed_id, item_id, reason                  | Feed engine | Admin, Merchandising | normal   | std      | 30d       |

## 13. Admin (operator-originated; mirrored to audit)

| Event                          | Description               | Payload                                               | Producer                | Consumers                  | Priority | Retry | Retention  |
| ------------------------------ | ------------------------- | ----------------------------------------------------- | ----------------------- | -------------------------- | -------- | ----- | ---------- |
| `catalog.product.published.v1` | Product published         | product_id, actor_id                                  | Catalog (admin)         | Search, Feed engine, Cache | high     | std   | 30d        |
| `pricing.discount.created.v1`  | Discount created          | discount_id, actor_id                                 | Pricing (admin)         | Cache, Analytics           | normal   | std   | 30d        |
| `experiment.launched.v1`       | Experiment started        | experiment_id, actor_id                               | Experimentation (admin) | Flag SDK, Analytics        | high     | std   | 30d        |
| `feed.published.v1`            | Feed definition published | feed_id, actor_id                                     | Feed engine (admin)     | Feed engine                | normal   | std   | 30d        |
| `identity.user.invited.v1`     | Staff invited             | email, role, actor_id                                 | Identity (admin)        | Notifications, Audit       | normal   | std   | 7y-archive |
| `audit.entry.recorded.v1`      | Generic audit record      | actor, action, resource, before/after, policy_version | All (admin)             | Audit store (WORM)         | high     | std   | 7y-archive |

## 14. System

| Event                               | Description                        | Payload                            | Producer        | Consumers              | Priority | Retry | Retention |
| ----------------------------------- | ---------------------------------- | ---------------------------------- | --------------- | ---------------------- | -------- | ----- | --------- |
| `system.outbox.published.v1`        | Outbox→broker confirmation         | source_table, row_id               | Debezium        | (internal)             | low      | none  | 30d       |
| `system.dlq.message_added.v1`       | Message dead-lettered              | topic, reason, event_id            | Any consumer    | Observability, On-call | critical | std   | 30d       |
| `system.job.failed.v1`              | Background job failed              | job, run_id, error                 | Any worker      | Observability          | high     | std   | 30d       |
| `system.cache.purge_requested.v1`   | Cache invalidation                 | surrogate_keys[]                   | Any context     | Cache/CDN              | high     | std   | compacted |
| `experiment.assignment.recorded.v1` | Variant assigned                   | experiment_id, subject_id, variant | Experimentation | Analytics              | normal   | none  | 13mo      |
| `experiment.exposure.logged.v1`     | Variant exposed (tie to [16]/[21]) | experiment_id, subject_id, variant | Experimentation | Analytics              | normal   | none  | 13mo      |

## Requires ADR to change

- Topic naming, delivery guarantees, or the priority/retry/retention key definitions in §1.
- Adding an event area, or changing the retention class of financial/audit events (7y-archive).
