# Task T5.16 report — Customer account and order history (design only)

## Status: DONE

This task's entire deliverable is a written design in `docs/plans/BLOCKERS.md`. No code was
written, no routes added, no cookies added, no guards added. Per the brief, that is the complete
and correct output for T5.16 — the checkbox in `docs/plans/PHASE-5-6-backlog.md` is ticked because
the design is written and complete, not because anything was implemented.

## Files changed

1. `docs/plans/BLOCKERS.md` — new `## T5.16 — Customer account and order history: DESIGN ONLY, no
code written` entry, inserted immediately before the existing `## T5.15` entry. Covers, in order:
   why the decision blocks four tasks, the authentication-flow recommendation (reuse Security's
   existing `Authenticate`/`EstablishSession`/session/MFA use cases via a new customer-facing guard,
   not a second auth stack), the session mechanism (new `morbeh-storefront-customer-session` cookie,
   carries an opaque Security `Session.id` never a raw `customerRef`, validation via
   session→principal→customer resolution, expiry/rotation via the existing `RefreshSession`/
   `RevokeSession`/`RevokeAllSessions` use cases, and the guest-cart-to-customer-account merge
   design using `Cart.assignCustomer`/`Cart.merge`, both of which already exist), the new backend
   surface (`GET /public/customers/me/orders`, cursor-paginated, session-derived scope only — plus a
   backend gap this route needs fixed first: `OrderRepository`/`OrderListQuery` has no exact-match
   `customerRef` filter today, only an unsafe substring `search` field), and the blast radius on
   T5.17/T5.19/T5.18-write (all three need only the same validated `customerRef`; Wishlist and
   Loyalty already have `findByCustomerRef` with no repository gap, Reviews already requires
   `customerRef` as a constructor/method argument).
2. `docs/plans/PHASE-5-6-backlog.md` — `T5.16` checkbox changed from `[ ]` to `[x]`.

No other files were touched. No `pnpm typecheck`/`lint`/`test`/`arch` was run — nothing was
implemented, so there is nothing to verify.

## Key recommendation (summary)

Reuse Security's existing, already-tested authentication/session machinery
(`Authenticate`/`EstablishSession`/`RefreshSession`/`RevokeSession`/`RevokeAllSessions`/MFA in
`services/security`, already wired into the admin console by T5.12e) for customer auth too, rather
than building a second password/session stack from scratch — wrap those same use cases in a new,
much lighter `CustomerGuard` (session-validity only, no ABAC permission check) instead of
`AdminGuard`, and link Identity's `Customer` to Security's `Principal` via `Principal.subjectRef =
customer.id` (the same "human principal references an Identity subject" pattern `Principal`'s own
doc comment already describes). Session identity travels in a new cookie
(`morbeh-storefront-customer-session`, distinct from the existing anonymous `GUEST_SESSION_COOKIE`)
that carries only an opaque Security session id — never a raw customer id — resolved server-side
on every request via session→principal→customer lookup, so revocation takes effect immediately.
On login, the existing (currently admin-only) `Cart.assignCustomer`/`Cart.merge` domain methods
should fold the guest cart into the customer's account, after which the guest cookie is cleared.
The new `GET /public/customers/me/orders` endpoint must derive its `customerRef` scope solely from
the validated session server-side, never from a client-supplied id — and needs one prerequisite
backend fix first: `OrderRepository`'s only customer-matching field today is a substring `search`,
not a safe exact-match filter, so a real `customerRef` exact filter (or a `listByCustomer` method)
must be added before this route can be safely wired to real data. T5.17 (Wishlist) and T5.19
(Loyalty) have no equivalent repository gap (`findByCustomerRef` already exists on both) and
T5.18-write (reviews) already requires `customerRef` as an argument — all three can be wired
directly against this same guard and resolution mechanism once it exists.
