# 03 — Integrations Hub specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Specification for a centralized integration
> center. Built on the port/adapter + plugin model
> ([arch 11 — integration and plugins](../architecture/11-integration-and-plugins.md)), the
> server-side tracking pipeline ([arch 09](../architecture/09-tracking-and-server-side-tracking.md)),
> the feed engine ([arch 18](../architecture/18-product-feed-specification.md)), and observability
> ([arch 13](../architecture/13-observability.md)). No application code.
>
> **Design system note:** there is no Integrations screen in the frozen admin
> ([`../ui/`](../ui/README.md)); this is a **net-new operator surface and requires approval** before
> any UI is built (it would live under Settings). This spec defines capability, not UI.

## 1. Cross-cutting compliance baseline

| Concern                | Requirement                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tracking               | Connector lifecycle (connect/sync/forward) emits operational events                                                         |
| Analytics              | Connector throughput/health queryable in ClickHouse                                                                         |
| Audit logs             | Connect/disconnect/credential-change/config → `audit.entry.recorded` (WORM)                                                 |
| Permissions            | `integration_admin` connects/edits; step-up to change credentials ([arch 07](../architecture/07-auth-and-authorization.md)) |
| Feature flags          | Every connector is independently enable/disable + kill switch ([growth 06](06-FEATURE_MANAGEMENT_SPEC.md))                  |
| Dark mode / Responsive | Operator surface uses frozen tokens + responsive rules                                                                      |
| Localization           | Connector labels/errors i18n-keyed                                                                                          |
| Accessibility          | WCAG 2.2 AA                                                                                                                 |
| Version history        | Connector config + credential rotations versioned                                                                           |

## 2. Connector model

Every integration is a **connector** implementing one standard contract, declared by a manifest
(id, category, capabilities, auth type, scopes, webhook support, data direction). Adding a
connector is a plugin/adapter behind a stable port ([arch 11](../architecture/11-integration-and-plugins.md)) — no core change.

### 2.1 Standard connector contract (the 12 required attributes — defined once, apply to all)

| Attribute       | Definition                                                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication  | OAuth2 (auth-code or client-credentials), API key/token, or signing secret; tokens auto-refreshed; secrets in Vault ([arch 14](../architecture/14-security.md)) — never displayed after entry |
| Permissions     | Declared scopes requested at connect; least-privilege; surfaced for operator consent                                                                                                          |
| Health status   | Rolling state: healthy / degraded / failing / disconnected (from §3 monitoring)                                                                                                               |
| Connection test | On-demand round-trip check (auth + minimal API call) with pass/fail + latency                                                                                                                 |
| Logs            | Per-connector request/response logs (PII-redacted) with correlation/trace ids                                                                                                                 |
| Retry           | Bounded exponential backoff + jitter; DLQ on exhaustion ([arch 05](../architecture/05-events-queues-workers-and-jobs.md))                                                                     |
| Sync status     | Last sync time, records pushed/failed, lag, next scheduled sync                                                                                                                               |
| Webhook support | Inbound webhooks: signature-verified, idempotent, converted to domain events                                                                                                                  |
| Error reporting | Normalized error taxonomy + provider error reconciled back (e.g. disapprovals)                                                                                                                |
| Monitoring      | Metrics + alerts on failure/lag/quota (ties [arch 13](../architecture/13-observability.md) + [growth 04](04-EVENT_HEALTH_CENTER_SPEC.md))                                                     |
| Reconnect       | Re-auth flow that preserves config + history; token-expiry self-heal                                                                                                                          |
| Versioning      | Connector + provider API version pinned; config changes versioned with rollback                                                                                                               |

## 3. Integration catalog

Auth: `OAuth2` (auth-code) · `CC` (client-credentials) · `KEY` (api key/token) · `SIG` (signing secret).
Direction: `OUT` (we push) · `IN` (webhooks) · `BOTH`.

### 3.1 Analytics & tag

| Integration           | Auth       | Direction | Webhook | Ties                                                                   |
| --------------------- | ---------- | --------- | ------- | ---------------------------------------------------------------------- |
| Google Analytics 4    | OAuth2     | OUT       | —       | Measurement Protocol; [growth 05](05-PURCHASE_PAYLOAD_MANAGER_SPEC.md) |
| Google Tag Manager    | OAuth2     | OUT       | —       | server container config                                                |
| Google Search Console | OAuth2     | IN        | —       | SEO metrics import                                                     |
| Looker Studio         | OAuth2     | OUT       | —       | ClickHouse/BQ connector for reporting                                  |
| Microsoft Clarity     | KEY/OAuth2 | BOTH      | —       | session replay/heatmaps ([growth 09 — session replay], when built)     |

### 3.2 Advertising (pixel + CAPI + catalog)

| Integration                                               | Auth   | Direction | Webhook | Ties                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Meta Business Manager / Pixel / Conversions API / Catalog | OAuth2 | BOTH      | IN      | CAPI ([arch 09](../architecture/09-tracking-and-server-side-tracking.md)); catalog ([arch 18](../architecture/18-product-feed-specification.md)); payload ([growth 05](05-PURCHASE_PAYLOAD_MANAGER_SPEC.md)) |
| Google Ads                                                | OAuth2 | OUT       | —       | conversions + Enhanced Conversions ([arch 17](../architecture/17-attribution-specification.md))                                                                                                              |
| TikTok Pixel / Events API / Catalog                       | OAuth2 | BOTH      | IN      | Events API + catalog                                                                                                                                                                                         |
| Snap Pixel / Conversions API / Catalog                    | OAuth2 | BOTH      | IN      | CAPI + catalog                                                                                                                                                                                               |
| Pinterest (tag / Conversions API / catalog)               | OAuth2 | BOTH      | IN      | CAPI + catalog                                                                                                                                                                                               |
| Microsoft Ads                                             | OAuth2 | OUT       | —       | UET + offline conversions                                                                                                                                                                                    |
| LinkedIn Insight Tag                                      | OAuth2 | OUT       | —       | B2B/school audience                                                                                                                                                                                          |

### 3.3 Merchant / feed channels (managed by the Feed Engine — [arch 18](../architecture/18-product-feed-specification.md))

| Integration                     | Auth   | Direction | Webhook          |
| ------------------------------- | ------ | --------- | ---------------- |
| Google Merchant Center          | OAuth2 | BOTH      | IN (item issues) |
| Meta Commerce Manager (Catalog) | OAuth2 | BOTH      | IN               |
| TikTok Catalog                  | OAuth2 | OUT       | IN               |
| Snap Catalog                    | OAuth2 | OUT       | —                |
| Pinterest Catalog               | OAuth2 | OUT       | —                |
| Microsoft Merchant Center       | OAuth2 | OUT       | —                |

### 3.4 Messaging

| Integration                          | Auth       | Direction | Webhook                  |
| ------------------------------------ | ---------- | --------- | ------------------------ |
| Email providers (SendGrid/Postmark…) | KEY        | BOTH      | IN (delivery/open/click) |
| WhatsApp providers (Cloud API…)      | KEY/OAuth2 | BOTH      | IN (delivery/read/reply) |
| SMS providers (Twilio…)              | KEY        | BOTH      | IN (delivery)            |

### 3.5 Commerce operations

| Integration                               | Auth       | Direction | Webhook                     |
| ----------------------------------------- | ---------- | --------- | --------------------------- |
| Payment gateways (Stripe/Adyen…)          | KEY/OAuth2 | BOTH      | IN (charge/refund/dispute)  |
| Shipping companies (carriers/aggregators) | KEY        | BOTH      | IN (tracking)               |
| CRM systems                               | OAuth2/KEY | BOTH      | IN (contact sync)           |
| ERP systems                               | KEY/CC     | BOTH      | IN (inventory/finance sync) |

## 4. Security and consent

- All secrets in Vault, short-lived where supported, auto-rotated; never shown after entry; egress allowlisted (anti-SSRF, [arch 14](../architecture/14-security.md)).
- Outbound marketing/conversion forwarding is **consent-gated** ([arch 16 §5](../architecture/16-tracking-specification.md)); Consent Mode signals only when ad consent denied ([arch 17 §9](../architecture/17-attribution-specification.md)).
- No connector forwards child-linked data ([arch 14](../architecture/14-security.md)).

## 5. Frozen-UI surface mapping

Net-new surface (Settings → Integrations) — **requires approval** ([`../ui/`](../ui/README.md)). Health/monitoring detail is rendered by the Event Health Center ([growth 04](04-EVENT_HEALTH_CENTER_SPEC.md)).

## Requires ADR to change

- The standard connector contract (the 12 attributes) or the port/adapter+plugin connector model.
- Adding an integration category, or any connector that bypasses Vault-secrets / consent-gating / SSRF-allowlist rules.
- Introducing the admin surface (also requires UI approval).
