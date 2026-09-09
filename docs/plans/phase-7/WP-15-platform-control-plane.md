# WP-15 — Platform control plane: Merchant 360, platform RBAC, impersonation

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** `WP-10` (a control plane that reaches across merchants needs the tenancy model
> `WP-10` builds — it cannot be bolted onto boot-time-pinned repositories) and `WP-14` (profitability
> reporting reads the billing ledger `WP-14` produces).
> **Conflicts with:** `WP-3`, `WP-5`, `WP-6`, `WP-7`, `WP-9`, `WP-10`, `WP-13`, `WP-14`
> (`apps/runtime/src/composition.ts`) and `WP-4`, `WP-5`, `WP-6`, `WP-8`, `WP-9`, `WP-13`, `WP-14`
> (`apps/admin/src/http/admin-routes.ts`, though this WP's own routes should live in a _separate_
> app, not `apps/admin` — see below).
> **Closes:** Morbeh F-08 (delegation exists; platform→merchant impersonation semantics do not),
> F-18 (`services/platform-console` is a 226-line read-model stub).

## Why this exists

Verified: `services/platform-console/src/` totals 135 lines across `composition.ts`, `index.ts`,
`interfaces/`, and `read-model/` — a read-model shell with no platform-admin surface behind it.
Separately, `packages/db/prisma/schema/security.prisma:203` defines a `SecurityDelegation` model
and `services/security/src/application/delegation.use-cases.ts` implements delegation use cases —
the primitive for "one identity acting as another" already exists, but nothing extends it to
"platform operator acting as a merchant," and nothing gives a platform operator a role model
distinct from a merchant's own admin roles.

Note the asymmetry this closes: `services/customer-360` is this platform's largest service (a real
CDP with 72 use cases, per `phase-7/README.md`'s own measurement) — it is Merchant 360's mirror
image, aimed at the wrong subject. Merchant 360 (the platform operator's view of _a merchant_, not
a merchant's view of _a customer_) does not exist.

## Decisions, already made

1. **A separate application with its own role model, not a privileged mode of `apps/admin-web`.**
   `apps/admin-web` is a merchant's operator surface; giving it a "platform mode" would mean every
   route in it has to reason about two different authorization universes. A separate app
   (`apps/platform-admin`, following `apps/admin-web`'s own Next.js structure as the template) keeps
   platform RBAC and merchant RBAC from ever being checked by the same code path by accident.
2. **Impersonation extends the existing `SecurityDelegation` aggregate — it does not invent a
   second identity-swap mechanism.** Read `services/security/src/domain/` for the aggregate's
   current shape and `delegation.use-cases.ts` for its use cases before adding fields. Every
   impersonation session requires: a reason (recorded, not optional), an approval step (optional
   per Morbeh's own framing — decide and document whether _this_ platform requires it always or
   only above some risk threshold), a visibly marked session (the operator, and ideally the
   merchant, can tell an impersonated session is active), and a full audit trail through the
   existing `AuditTrail` port in `@platform/contracts` — never a silent identity swap.

## Tasks

- [ ] **T15.1 — Read the existing primitives.**
      `packages/db/prisma/schema/security.prisma`'s `SecurityDelegation` model in full;
      `services/security/src/domain/` and `application/delegation.use-cases.ts`;
      `services/platform-console/src/` in full (135 lines — read all of it, not a sample);
      `packages/entitlement`'s `EntitlementGuard` (the same PEP `WP-5`'s Copilot gate reuses) to
      confirm whether platform-role checks should route through it or need a parallel guard.

- [ ] **T15.2 — `apps/platform-admin`.**
      A new Next.js app, server-side only for any call into the runtime API (same rule as
      `apps/admin-web` — never call the runtime API from browser JS; the token must not reach the
      client). Screens: merchant search, Merchant 360 (a merchant's profile, usage, plan, health —
      the mirror of Customer 360's role, aimed at a merchant instead of a customer), plans and
      subscriptions (reads `WP-14`'s billing layer), revenue and usage, feature adoption, churn
      signals.

- [ ] **T15.3 — Platform RBAC.**
      A role model distinct from merchant roles — a platform support agent, a platform admin, and
      whatever granularity the existing merchant `AdminGuard`/role system already demonstrates is
      worth copying (read how `apps/admin/src/interfaces/*.admin-controller.ts`'s `AdminGuard`
      wrapper composes with roles, and mirror the pattern for platform roles rather than inventing a
      new authorization primitive).

- [ ] **T15.4 — Extend delegation for platform→merchant impersonation.**
      Add whatever `SecurityDelegation` is missing to express "platform operator X is acting as
      merchant Y's admin, with reason R, from timestamp T, [optionally approved by Z]." Every
      request made during an impersonation session carries the impersonation context through to the
      audit trail — the audited actor is both the real operator and the merchant identity being
      acted as, never only one of them.

- [ ] **T15.5 — Impersonation UI markers.**
      Both surfaces show it: `apps/platform-admin` makes an active impersonation session
      impossible to mistake for a normal session (a persistent banner, not a small badge), and — if
      the merchant-side surface can detect it — `apps/admin-web` shows the merchant that their
      session is currently being acted on, if the platform's trust model calls for that visibility
      (decide and document this choice; it is a real product/trust decision, not a default).

- [ ] **T15.6 — Merchant profitability.**
      Computed from `WP-14`'s billing ledger and `WP-11`'s decimal financial data — revenue from
      that merchant's subscription and usage, minus their proportional share of platform costs
      where that can be honestly attributed, presented per merchant on the Merchant 360 screen.
      **Never fabricate an attribution the platform cannot actually compute** — if platform-cost
      attribution per merchant is not yet buildable, show gross revenue per merchant and say
      explicitly that cost attribution is not yet available, per the "never fabricate data" rule in
      `../README.md`.

- [ ] **T15.7 — Tests.**
      A test proving a platform role cannot act as a merchant without a recorded reason. A test
      proving an impersonated session's actions are audited under both identities. A test proving
      platform RBAC and merchant RBAC are checked by genuinely separate code paths (e.g., a platform
      role with no merchant-side grant still cannot read merchant-scoped data through
      `apps/admin-web`'s routes).

## Definition of done

- [ ] An impersonated session is unmistakable in the platform-admin UI, fully audited under both
      identities, and reversible (the operator can end it explicitly).
- [ ] No platform role acts as a merchant without a recorded reason.
- [ ] Merchant profitability reconciles to the ledger, with an explicit "not available" state where
      cost attribution cannot yet be computed honestly.
- [ ] Morbeh F-08 and F-18 closed in `docs/architecture/23-platform-gap-register.md` and
      `docs/KNOWN_GAPS.md`.
- [ ] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch`.

## Known traps

- **Do not let `apps/platform-admin` import from `apps/admin` or `apps/admin-web`.** They are
  separate apps by design (Decision 1) — share logic through `packages/*`/`services/*`, never by
  cross-app import (`pnpm arch` will not catch an `apps/*` → `apps/*` import; the eight existing
  named rules are about `packages`/`services` boundaries, not inter-app ones — review this by hand).
- **Impersonation is the single highest-trust feature in this roadmap.** A bug here is a platform
  employee silently reading or acting as any merchant. Treat T15.7 as non-negotiable, not as an
  ordinary test-coverage line item.
- **This WP depends on both `WP-10` and `WP-14` landing first** — do not start T15.6 (profitability)
  before `WP-14`'s ledger exists, and do not start T15.2's cross-merchant reads before `WP-10`'s
  per-request tenant scoping replaces the boot-time-pinned repositories, or Merchant 360 will be
  built against an object graph that cannot actually see more than one tenant.
