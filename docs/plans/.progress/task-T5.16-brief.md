# Task T5.16 brief — Customer account and order history: DESIGN ONLY, no code

This task's deliverable is a written design in `docs/plans/BLOCKERS.md`, not working code. The
plan is explicit: "Before writing any code, write the design... a public `/public/orders` surface
scoped by an authenticated customer session is a security-design decision, not an implementation
detail." Do not build a login flow, do not add a customer-session cookie, do not add any new route
in this task. Producing a thorough, well-reasoned design document IS this task's complete, correct
output — do not feel compelled to also implement it to seem more done.

## Why this can't just be wired like every other Phase 5 task

- The storefront (`apps/storefront`) has **no login of any kind**. Confirmed:
  `apps/storefront/src/app/cart/actions.ts`'s `GUEST_SESSION_COOKIE` is an anonymous, randomly
  generated UUID (`crypto.randomUUID()`) minted fresh per new visitor — it identifies a cart, not
  a person, and carries no authentication. **Do not reuse or extend this cookie for identity** —
  the plan explicitly forbids it, and doing so would let anyone forge access to another
  customer's data by guessing/reusing a cart token.
- `GET /orders/:orderId` (`apps/admin/src/http/admin-routes.ts`) is `permission: "orders:read"`,
  gated behind the full admin `AdminGuard`/staff-principal auth — a storefront customer has no
  admin principal and never should.
- A `Customer` domain entity does exist (`services/identity/src/domain/customer.ts`,
  `customer-repository.ts`) — read it to understand what a customer already is in this system
  (fields, how it's created, how `Order.customerRef` relates to it) before designing anything.

## What the design must cover (write all of this into the BLOCKERS.md entry)

1. **Authentication flow**: how does a customer prove who they are? Options to weigh (this
   codebase already has substantial session/auth machinery in the Security bounded context —
   `services/security`'s Sessions & Authentication capabilities, `establishSession`/
   `authenticate`/MFA/etc., all currently only exposed on the admin-guarded `/security/*` surface,
   Phase 5 T5.12e territory). Investigate whether a **new, separate, public-facing** authentication
   surface should reuse that Security context's underlying use cases (unwrapped from the
   `AdminGuard`, wrapped in a new customer-facing guard instead), or whether customer auth
   deserves its own lighter mechanism. State a recommendation with reasoning, not just options.
2. **Session mechanism**: cookie name (distinct from `GUEST_SESSION_COOKIE`), what it carries (a
   signed/opaque customer session token, never a raw customer id), how it's validated on each
   request, expiry/rotation, and — critically — the relationship between an anonymous cart session
   and a newly-authenticated customer session (does the guest cart merge into the customer's
   account on login? out of scope to implement, but the design should say what *should* happen so
   a future task doesn't have to re-derive it).
3. **New backend surface needed**: a `public/orders` (or `me/orders`) read endpoint scoped to the
   authenticated customer's own orders only — never accepting a client-supplied customer id as the
   scope, always deriving it from the validated session server-side. Sketch the route shape
   (method, path, auth requirement, response shape) without building it.
4. **Blast radius on other Phase 5 tasks**: T5.17 (Wishlist), T5.19 (Loyalty balance), and T5.18's
   review-writing half all depend on this same decision — state explicitly what they each need
   from it (a validated `customerRef` server-side, nothing more) so those tasks can implement
   against your design directly once it's approved.
5. **What this design explicitly does NOT do**: implement anything. Note that clearly at the top
   and bottom of the BLOCKERS.md entry so a future session doesn't mistake the design for done
   work.

## Global constraints

1. `packages/*`/`services/*` never import from `apps/*` (not directly relevant — no code this
   task).
2. Never fabricate data (not directly relevant — no code this task).
3. Do not run `git` commands.
4. Do not ask questions — this task's whole point is to produce the decision itself, not defer it.
5. Mark this task's checkbox (`- [ ] **T5.16 Customer account and order history.**` →
   `- [x] **T5.16 Customer account and order history.**`) once the BLOCKERS.md design entry is
   written and complete — a written design is this task's whole deliverable, "done" does not mean
   "implemented."

## Verify

No code changes are expected; if you touched none, there is nothing to run. If you find yourself
about to run `pnpm typecheck`/`lint`/`test`, stop and check whether you've accidentally started
implementing — this task should produce zero diffs outside `docs/plans/BLOCKERS.md` and the
backlog checkbox.

## Report

Write your full report to `docs/plans/.progress/task-T5.16-report.md`, including the design's key
recommendation in summary form. Return to the controller only: status, files changed (should be
exactly `docs/plans/BLOCKERS.md` + the backlog checkbox), concerns.
