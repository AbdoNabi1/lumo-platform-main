# 05 — Purchase Payload Manager specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Specification for an operator-configurable
> purchase-event payload builder. It is the **config layer** over the tracking platform-mapping
> matrix ([arch 16 §8](../architecture/16-tracking-specification.md)); it reuses the dedup
> ([arch 16 §3/§4](../architecture/16-tracking-specification.md)), consent
> ([arch 16 §5](../architecture/16-tracking-specification.md)), Enhanced Conversions + click IDs
> ([arch 17](../architecture/17-attribution-specification.md)), and server-side forwarding
> ([arch 09](../architecture/09-tracking-and-server-side-tracking.md)) defined in the architecture
> contract. No application code.
>
> **Design system note:** **net-new surface, requires approval** ([`../ui/`](../ui/README.md)); would live
> under Settings → Integrations. Spec defines capability, not UI.

## 1. Cross-cutting compliance baseline

| Concern                | Requirement                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking               | Operates on `purchase_completed` / `order_refunded` ([arch 16 §10.7](../architecture/16-tracking-specification.md)); forwards carry the shared `dedup_id` |
| Analytics              | Forward results visible in the Event Health Center ([growth 04](04-EVENT_HEALTH_CENTER_SPEC.md))                                                          |
| Audit logs             | Profile create/edit/publish → `audit.entry.recorded` (WORM)                                                                                               |
| Permissions            | Edit vs. publish a profile separated; step-up to publish ([arch 07](../architecture/07-auth-and-authorization.md))                                        |
| Feature flags          | Per-destination forwarding toggle + kill switch ([growth 06](06-FEATURE_MANAGEMENT_SPEC.md))                                                              |
| Dark mode / Responsive | Operator surface uses frozen tokens + responsive rules                                                                                                    |
| Localization           | Labels i18n-keyed; currency/locale-aware value formatting                                                                                                 |
| Accessibility          | WCAG 2.2 AA                                                                                                                                               |
| Version history        | Every profile is versioned with rollback (§9)                                                                                                             |

## 2. Concept

A **purchase payload profile** is a versioned, per-destination configuration that maps our canonical
purchase model to a destination's purchase event — selecting which fields are sent, how they're
transformed, which PII is hashed, and the consent gate. Profiles are **config, not deploys**.

## 3. Canonical purchase source model

From `purchase_completed` ([arch 16 §10.7 + §6.3](../architecture/16-tracking-specification.md)):
`transaction_id`, `value`, `currency`, `tax`, `shipping`, `coupon`, `items[]` (`item_id`,
`item_group_id`, `item_name`, `item_brand`, `item_category`, `price`, `quantity`), user identifiers
(`email_hash`, `phone_hash`, name/address — hashed), captured click IDs, `dedup_id`, `event_time`,
`action_source`.

## 4. Per-destination specifications

`Hashed` = SHA-256 normalized, server-side. `Dedup` = the field that receives our shared `dedup_id`.
Click IDs captured/persisted per [arch 17 §2.2](../architecture/17-attribution-specification.md).

| Destination       | Required                                                                                                                           | Optional                                               | Hashed identifiers                               | Click ID               | Dedup field                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ | ---------------------- | -------------------------------------- |
| **GA4**           | transaction_id, value, currency, items[], client_id/user_id                                                                        | tax, shipping, coupon, affiliation                     | user-provided email/phone (UPDC)                 | gclid                  | transaction_id                         |
| **Meta**          | event_name=Purchase, event_time, action_source, ≥1 user_data id, value, currency                                                   | contents[], content_ids, num_items, order_id, fbc, fbp | em, ph, fn, ln, ct, st, zp, country, external_id | fbclid→fbc             | event_id                               |
| **TikTok**        | event=CompletePayment, event_id, event_time, ≥1 user id, value, currency, contents[]                                               | content_type, order_id, ip, user_agent                 | email, phone, external_id                        | ttclid→ttp             | event_id                               |
| **Snap**          | event_type=PURCHASE, event_conversion_type, timestamp, ≥1 hashed id, price, currency                                               | transaction_id, item_ids, number_items                 | hashed_email, hashed_phone                       | scclid→sc_click_id     | client_dedup_id                        |
| **Google Ads**    | conversion_action, conversion_date_time, conversion_value, currency_code, + gclid/gbraid/wbraid OR enhanced-conversion identifiers | order_id                                               | email, phone, address (Enhanced Conversions)     | gclid/gbraid/wbraid    | order_id                               |
| **Pinterest**     | event_name=checkout, event_id, action_source, ≥1 user_data id, value, currency                                                     | content_ids, contents, num_items, order_id             | em, ph                                           | epik                   | event_id                               |
| **Microsoft Ads** | purchase event, value, currency, transaction_id (UET) / msclkid + conversion (offline)                                             | order_id                                               | email, phone (Enhanced Conversions)              | msclkid                | transaction_id                         |
| **Server Side**   | canonical superset; fans out to all enabled destinations                                                                           | all of the above                                       | full hashed identifier set                       | all captured click IDs | `dedup_id` (shared with client pixels) |

## 5. Mapping and transformation rules

- **Mapping:** each profile maps canonical fields → destination fields (per §4); unmapped optional fields are omitted.
- **Transformations:** value = order total (configurable incl./excl. tax + shipping per destination); currency normalized to ISO-4217; `items[]` reshaped to each destination's contents schema; category mapped to the destination taxonomy; static defaults (e.g. `content_type=product`, `action_source`) injected per destination.

## 6. Hashing rules

PII is normalized (lowercase/trim, E.164 for phone) then SHA-256 hashed **server-side** before
send; raw PII never leaves our boundary ([arch 14](../architecture/14-security.md)). Each
destination's required hashed-identifier set is enforced (§4).

## 7. Consent rules

Forwarding requires the `marketing` consent tier; when ad consent is denied, only Consent Mode
signals are sent (no identifiers) ([arch 16 §5](../architecture/16-tracking-specification.md),
[arch 17 §9](../architecture/17-attribution-specification.md)). Child-linked purchases are never forwarded.

## 8. Validation, preview, test event

- **Validation:** required fields present per destination, types/enums valid, currency present, `dedup_id` set, required hashed identifiers present, consent satisfied — block publish on failure.
- **Preview payload:** render the exact payload that would be sent for a sample/real order (PII shown as hashed), per destination.
- **Test event:** send a flagged test conversion to the destination's test tooling (e.g. Meta Test Events, GA4 DebugView, TikTok test events) and show acceptance + any platform diagnostics.

## 9. Retry and version history

- **Retry:** forwarding uses the `extended` retry policy with DLQ ([arch 20](../architecture/20-events-catalog.md)); results surface in the Event Health Center ([growth 04](04-EVENT_HEALTH_CENTER_SPEC.md)).
- **Version history:** every profile change is an immutable version with diff, rollback, and audit; the active version per destination is explicit, and diagnostics reference the version that produced a payload.

## 10. Frozen-UI surface mapping

Net-new surface (Settings → Integrations → Purchase payloads) — **requires approval** ([`../ui/`](../ui/README.md)).

## Requires ADR to change

- The canonical purchase model, the per-destination required-field sets, or the hashing/consent rules.
- The "profiles are config, not deploys" rule, the shared-`dedup_id` requirement, or the validate-before-publish gate.
- Introducing the admin surface (also requires UI approval).
