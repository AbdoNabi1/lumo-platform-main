# 25 — Theme and storefront platform

> **Status: CONTRACT — 2026-07-04 (ADR-0010).** The merchant-facing rendering platform: themes
> (declarative, sandboxed) and the storefront API tier. Complements doc 04 (API tiers), doc 15
> (performance budgets, CDN), doc 16 (tracking), ADR-0008 (tenancy). **Design contract — the
> storefront phase implements it; the current `apps/storefront` walking skeleton is not it.**

## 1. Theme model (declarative, per ADR-0010 §3)

A theme is a versioned **data package** — never server-side code:

```
theme/
  manifest.json        # id, semver, apiVersion, settingsSchema
  layouts/             # HTML skeletons with content outlets (theme.liquid equivalent)
  templates/           # per page type: product, collection, cart, page, blog, 404…
  sections/            # composable page regions with their own settings + block lists
  blocks/              # smallest configurable units inside sections
  assets/              # css/js/images — CSP-constrained, CDN-served
  locales/             # translation dictionaries (storefront i18n)
```

- **Settings schema** drives the merchant theme editor (JSON-schema; no code).
- **Sections/blocks** are the composition unit (Shopify OS 2.0 shape): templates reference
  sections; merchants reorder/configure sections and blocks per page without touching markup.
- **Versioning & publishing:** themes are immutable per version; a tenant has draft / preview /
  live pointers; publish = pointer swap (instant rollback). Edits create a new draft version.
- **Dev loop:** local dev serves a draft with hot reload (file-watch → re-render); no special
  runtime — the same renderer, watching files.

## 2. Rendering pipeline (sandboxed)

`request → route resolution (tenant + page type) → data resolution (storefront API, scoped
object model) → template AST render → HTML`.

- **Liquid-compatible semantics**: templates parse to an AST once (cached per theme version) and
  render against an **allowlisted object model** (`product`, `collection`, `cart`, `shop`,
  `customer`-safe-subset, …). No I/O, no network, no arbitrary code, bounded loops/depth,
  render time/memory budgets enforced by the renderer — a theme can be slow only for itself.
- **Escaping by default** (XSS); raw output is an explicit, lintable filter.
- **Evolution path:** server rendering first (SSR at the app tier) → cache-at-CDN for anonymous
  traffic → edge rendering for personalization-light pages; WASM edge functions remain a
  possible future for latency-critical extensions (ADR-0010 alternatives).

## 3. Storefront API tier

- **GraphQL-first** for the storefront (doc 04 tier), unauthenticated-but-tenant-scoped: every
  request resolves a tenant (custom domain / subdomain → `tenantId`, ADR-0008) before anything
  else; there is no tenant-less storefront query.
- **Read-optimized:** backed by the CDC-fed read models (G-8) — never by command-side
  repositories; cursor pagination only (doc 04 §2); bulk-friendly for large catalogs (doc 15).
- **Caching:** anonymous responses are CDN-cacheable with tag-based invalidation keyed by
  `(tenantId, entityType, entityId)`; invalidation is driven by the same integration events the
  contexts already emit (doc 20 §1.1) — no new invalidation source of truth.
- **Versioned** like every public API (doc 04); themes declare the `apiVersion` they target.
- **SEO/localization:** canonical URLs, structured data, and `locales/` dictionaries are theme
  concerns; the API exposes locale-aware fields (future Pricing/Catalog i18n follows its own
  ADR when scoped).

## 4. Security summary

Theme risk reduces to renderer correctness (sandbox, budgets, escaping) + CSP on assets; app
risk reduces to scopes + signatures (doc 24). Neither can execute in a platform process.
Storefront tenant isolation is structural: tenant resolution precedes data access, and read
models are tenant-keyed (ADR-0008 §2).

## Requires ADR to change

The no-server-side-theme-code rule, the object-model allowlist approach, the tenant-resolution-
first rule, or serving the storefront from command-side repositories.
