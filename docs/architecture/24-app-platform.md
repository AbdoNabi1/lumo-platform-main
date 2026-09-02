# 24 — App platform (third-party apps)

> **Status: CONTRACT — 2026-07-04 (ADR-0010).** How untrusted third-party apps extend the
> platform. Complements doc 11 (first-party plugins), doc 04 (API tiers, webhooks), doc 07
> (permissions), ADR-0008 (tenancy). **Design contract — implementation begins after the public
> API tier exists (Phase 2 transport + auth).** Nothing here may be implemented in-process.

## 1. Model

An **app** is an external service owned by a third-party developer. It touches the platform only
through: (a) public APIs under an OAuth client with tenant-granted scopes, (b) signed webhooks,
(c) declarative UI extension slots. See ADR-0010 for why.

## 2. App manifest

Declarative, versioned, validated at submission and at install:

| Field                             | Meaning                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `developer`         | Identity; `id` is immutable                                                                               |
| `version`                         | Semver; upgrades are explicit tenant-visible events                                                       |
| `apiVersion`                      | Public API version range the app is built against (doc 04 versioning)                                     |
| `scopes`                          | Requested permissions, `"<module>:<action>"` (doc 07) — least privilege, shown to the merchant at install |
| `webhooks`                        | Subscribed topics from the events catalog (doc 20) + delivery endpoint                                    |
| `extensionSlots`                  | Declared admin/storefront slots used (doc 11 §3; frozen-UI governed)                                      |
| `settingsSchema`                  | JSON-schema for per-tenant app configuration                                                              |
| `redirectUrls`, `webhookEndpoint` | HTTPS only; verified at submission                                                                        |

## 3. Authorization

- **OAuth 2.0 + PKCE** authorization-code flow per tenant install; the granted token carries
  `(appId, tenantId, scopes)` — an app never holds a cross-tenant credential.
- Scopes map 1:1 onto the platform `Permission` model; the API gateway enforces them through the
  same `AccessControl` seam as staff actions (ADR-0007) — one authorization model, two principals
  (`kind: "service"` for apps).
- Token lifecycle: short-lived access + rotating refresh; revocation on uninstall is immediate
  (`identity.token.revoked`, doc 20 §2).

## 4. Lifecycle (all tenant-scoped, all audited per ADR-0009)

`submit → review → listed` (developer side) · `install (scope grant) → configure → enable ↔
disable → upgrade (re-consent when scopes grow) → uninstall (token revocation + webhook
unsubscription + scheduled data-purge notice)` (merchant side). Every transition emits an
integration event (future `apps.*` topics in doc 20) and an audit entry.

## 5. Containment

- **Rate limits** per `(appId, tenantId)` bucket — an abusive app degrades itself, not the tenant
  or platform (G-3 port).
- **Webhook delivery**: at-least-once, HMAC-signed (key per app), retried per doc 20 policy keys,
  DLQ'd per app; a dead app endpoint never blocks the emitting context (outbox → dispatcher).
- **Data access** is scope-bounded and tenant-bounded; bulk endpoints are the sanctioned path for
  large reads (doc 15 budgets).

## 6. App store readiness (post-MVP)

The store is a catalog of manifests + review workflow + billing hooks (tenant billing is the
future `Tenancy` context's concern, ADR-0008). Nothing in this contract changes when the store
UI ships — it is a consumer of the manifest + lifecycle model above.

## Requires ADR to change

The out-of-process rule (ADR-0010), the manifest contract, the scope model, or webhook signing.
