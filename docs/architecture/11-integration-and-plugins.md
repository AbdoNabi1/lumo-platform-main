# 11 — Integration architecture and plugin system

> **Status: CONTRACT — 2026-06-28.** Defines how third parties are integrated and how the platform
> is extended without modifying core.

## 1. Integration architecture

All external dependencies are integrated behind **ports** (interfaces) in the domain/application
layer, implemented by **adapters** in infrastructure. The domain never depends on a vendor.

| Capability         | Port                            | Initial adapters                               |
| ------------------ | ------------------------------- | ---------------------------------------------- |
| Payments           | `PaymentGateway`                | Stripe, Adyen (multi-PSP routing)              |
| Tax                | `TaxCalculator`                 | Avalara                                        |
| Shipping           | `ShippingRates`/`LabelProvider` | Shippo, ShipEngine                             |
| Fraud              | `FraudScreen`                   | Signifyd                                       |
| Email/SMS/WhatsApp | `MessageChannel`                | SendGrid, Postmark, Twilio, WhatsApp Cloud API |
| CAPI destinations  | `ConversionSink`                | Meta, Google, TikTok, Pinterest (doc 09)       |
| Feed channels      | `FeedChannel`                   | GMC, Meta, TikTok, Pinterest (doc 10)          |
| CMS/media          | `ContentSource`/`MediaStore`    | Sanity, S3/R2                                  |

Integration rules:

- **Anti-corruption layer** at every boundary — translate vendor models to ours.
- **Idempotent, retryable, observable** outbound calls; circuit breakers + timeouts; secrets from Vault.
- **Inbound webhooks** are signature-verified, idempotent, and converted to domain events at the edge of the owning context.
- Swapping or adding a vendor is an adapter change behind a stable port — no domain change.

## 2. Plugin system

Extensions add behavior at defined **extension points** without touching core. Plugins are how new
channels, feeds, payment methods, and automation steps are added.

### 2.1 Extension point types

| Type                   | Mechanism                                                 | Examples                                                              |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Adapter plugins        | Implement a port                                          | a new PSP, channel, feed destination, CAPI sink                       |
| Event subscribers      | Subscribe to domain events                                | a custom side-effect on `order.placed`                                |
| Workflow steps         | Register a Temporal activity                              | a custom automation/fulfillment step                                  |
| Admin surface (future) | Declared extension slots in the admin                     | **must be built from Morbeh Design System primitives — see `../ui/`** |
| Storefront blocks      | page-builder block registry (`packages/page-builder-kit`) | a new content block                                                   |

### 2.2 Plugin contract and isolation

- A plugin declares: id, version, the extension points it implements, required config schema, and required scopes/permissions.
- Plugins depend only on stable contracts (`packages/domain-events`, port interfaces) — never on another context's internals.
- **Isolation:** plugins run with least-privilege scopes; failures are contained (a failing subscriber cannot block the emitting transaction — it consumes events asynchronously with its own DLQ).
- **Lifecycle:** install → configure → enable/disable (via feature flags, doc 12) → version → deprecate. Disabling a plugin is instant and safe.

## 3. Relationship to UI

Any plugin that needs an admin or storefront surface must use existing extension slots; introducing
a new visible surface is a UI change governed by the Morbeh Design System contract (`../ui/`).

## Requires ADR to change

- The port/adapter integration pattern or adding integrations that bypass a port.
- The plugin extension-point set, the isolation model, or allowing plugins to access context internals.
