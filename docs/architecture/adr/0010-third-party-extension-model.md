# ADR-0010: Third-party extensions run out-of-process; themes are declarative and sandboxed

- **Status:** Accepted
- **Date:** 2026-07-04
- **Deciders:** Staff architecture (Shopify-class platform review)
- **Affected documents:** 04, 07, 11, 24, 25

## Context

Doc 11 defines **first-party** extension points (adapter plugins behind ports, event subscribers,
workflow steps) — trusted code, deployed by us. A Shopify-class platform additionally needs
**third-party** extensions written by people we do not trust: merchant apps, an app store, and
merchant-customizable themes. The single most consequential decision is _where third-party code
executes_. In-process plugin loading (the WordPress/Magento model) couples our availability,
security, and upgrade cadence to code we did not write — it is the primary reason those
ecosystems suffer supply-chain compromise and upgrade paralysis at scale.

## Decision

1. **Third-party apps are external services (the Shopify model).** An app never runs inside a
   platform process. It integrates exclusively through: the public APIs (doc 04 tiers) under an
   **OAuth client with tenant-granted scopes** (mapped onto the existing `Permission` model,
   doc 07); **signed webhooks** (doc 04 §4) for events it subscribes to; and **declarative UI
   extension slots** (doc 11 §3, frozen-UI governed). App misbehavior is contained by scopes,
   per-app+tenant rate limits, and webhook isolation — never by process sandboxing we'd have to
   get perfect.
2. **First-party plugins keep doc 11's in-process model** (ports/subscribers/workflow steps) —
   trusted, reviewed, versioned with the platform. The two tiers are not interchangeable; a
   third-party capability that needs a port implementation ships as a first-party adapter after
   review, or not at all.
3. **Themes are data, not programs.** A theme is a declarative package (layouts, templates,
   sections, blocks, settings schema, assets) rendered by a **sandboxed template engine** with
   Liquid-compatible semantics: no arbitrary code execution, no I/O, no network, bounded loops,
   an explicit allowlisted object model (the storefront data scope), and render budgets
   (time/memory) enforced by the renderer. Client-side interactivity ships as assets subject to
   CSP; server-side theme code does not exist.
4. **Manifests are the contract** for both apps and themes: id, semver version, required
   scopes/permissions, subscribed webhook topics, extension slots used, settings schema, and
   compatibility range against the public API version. Install/upgrade/uninstall are
   tenant-scoped lifecycle operations recorded on the audit trail (ADR-0009).

## Consequences

- **Positive:** untrusted code can never take down or breach the core; platform upgrades never
  break in-process third-party code (there is none); the app-store trust model reduces to API
  scopes + webhook signatures — both already-designed seams; theme security reduces to renderer
  correctness rather than code review of merchant themes.
- **Negative / trade-offs:** apps pay network latency for everything (mitigated by bulk APIs and
  webhooks); some deep customizations possible in-process are impossible by design (accepted —
  Shopify proves the ceiling is high enough); the sandboxed renderer is a serious engineering
  investment when storefront work begins.
- **Follow-ups:** doc 24 (app platform), doc 25 (theme + storefront platform); OAuth
  client/scope issuance design with the transport sprint; renderer selection/build with the
  storefront phase.

## Alternatives considered

- **In-process plugin loading (VM sandboxes, `isolated-vm`, workers)** — rejected: sandbox
  escapes are a when-not-if at app-store scale; upgrade coupling; dependency-graph hell inside
  one process.
- **WASM plugin runtime** — promising for _edge functions_ later (doc 25 keeps the door open),
  but as the primary app model it fragments the developer ecosystem today; revisit when a
  concrete latency-critical extension class demands it.
- **No third-party model (integrations only)** — rejected: contradicts the platform mission.
