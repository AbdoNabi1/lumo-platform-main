# WP-1 — Close the commerce loop: let a guest complete a purchase

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Safe to run in parallel with:** WP-8.
> **Closes:** G-52 (C-2), and unblocks `apps/e2e/tests/guest-purchase.spec.ts`.

## Why this exists

The platform cannot sell to an unauthenticated visitor. Every storefront session is a guest by
definition, and:

- `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts:71` throws a plain `Error`
  when `input.customerRef === undefined`. Its own doc comment records this as deliberate: _"guest
  checkout cannot complete an order today… needs a product decision."_
- `apps/admin/src/http/public-checkout-routes.ts:14` deliberately refuses a client-supplied
  `customerRef` — correctly, because accepting one would let a caller attach their session to
  someone else's customer record.
- `CheckoutSessionProps` (`services/checkout/src/domain/checkout-session.ts:30`) has **no email
  field at all**. There is currently nowhere to put a guest's contact address.
- `apps/e2e/tests/guest-purchase.spec.ts:44` is annotated `test.fail()` for exactly this.

So the gap is not a missing null-check. It is a missing product decision plus the field to carry it.

## The decision, already made — implement this, do not re-open it

**On completion of a guest checkout, find-or-create a customer in Identity from the session's
contact email, and place the order against that customer.**

Rejected alternative: making `Order.customerRef` optional. It is rejected because every downstream
context — Customer 360's identity graph, Loyalty, Returns, order history, LTV — is keyed on a
customer reference. An order with no customer is invisible to the entire data layer, which is the
opposite of what this platform is for. A guest customer record, created from the email the guest
already typed to receive their receipt, gives the CDP a real node to stitch later when that person
registers.

Three constraints on that decision, all non-negotiable:

1. **Find-or-create, never create-blindly.** `RegisterCustomer`
   (`services/identity/src/application/register-customer.use-case.ts:48`) returns
   `ConflictError` when the email already exists. A returning guest using the same email must
   resolve to the _existing_ customer, not fail. But — and this is the security-critical half —
   resolving to an existing customer must **never** confer session access to it. The guest gets an
   order attached to that customer id; they do not get logged in, and no route may start returning
   that customer's history to an unauthenticated session.
2. **The guest customer is marked as such.** A customer created this way is materially different
   from one who registered — no password, no verified email, no consent given. Mark it, so
   Customer 360 and Notifications can tell the difference and so a later registration can upgrade it.
3. **Consent is not implied.** Do not record a marketing-consent record for a guest. Placing an
   order is a transaction, not an opt-in. `ConsentRecord` in `services/identity` is append-only and
   derived from a log — leave it empty for guests.

## Tasks

- [x] **T1.1 — Add a contact email to the checkout session.**
      `services/checkout/src/domain/checkout-session.ts`: add `contactEmail?: string` to
      `CheckoutSessionProps` and a `setContactEmail(email, eventId, occurredAt)` method following
      the shape of the existing `setBillingAddress` / `setShippingAddress` methods exactly
      (same guard style, same state-machine position, same event emission if the siblings emit).
      Validate the email with `Email` from `services/identity`? **No** — that would be a
      cross-context import, which `pnpm arch` forbids. Add a local `ContactEmail` value object in
      `services/checkout/src/domain/value-objects/`, modelled on
      `services/identity/src/domain/value-objects/email.ts`. Duplication across contexts is the
      correct trade here; the rule-of-three promotion to `@platform/domain` is a later call.
      Write the domain test alongside, in the style of `checkout-session.test.ts`.

- [x] **T1.2 — Persist it.**
      Add the column to the checkout schema in `packages/db/prisma/schema/` (one file per context —
      find the checkout one), generate a migration under
      `packages/db/prisma/schema/migrations/` following the naming convention of the newest
      existing migration directory. Update
      `services/checkout/src/infrastructure/*mapper*` and the Prisma repository. The column is
      nullable — every session created before this migration has no contact email.

- [x] **T1.3 — Expose it publicly.**
      Add `POST /public/checkouts/:checkoutSessionId/contact` to
      `apps/admin/src/http/public-checkout-routes.ts`, copying the shape of the neighbouring
      `.../billing-address` route exactly (same zod body validation, same session-ownership check
      — read how that route proves the caller owns the session and reuse it verbatim; same
      `idempotent` flag choice, same DTO mapping). Add its route test.

- [ ] **T1.4 — Add find-or-create to Identity.**
      New use case `services/identity/src/application/resolve-guest-customer.use-case.ts`:
      given an email and a name, return the existing customer's id if one exists with that email,
      otherwise create one marked as a guest and return the new id. Model it on
      `register-customer.use-case.ts` — same `unitOfWork.run` transaction shape, same
      `findByEmail` call, same `Email` validation — but replace the `ConflictError` branch with
      "return the existing id".
      Add the guest marker to the `Customer` aggregate (`services/identity/src/domain/`): a
      boolean or an enum-ish origin field, your choice, but it must be part of `reconstitute` and
      persisted. Emit `customer.registered` **only** on the create branch, never on the find
      branch — the outbox must not publish a registration for someone who registered months ago.
      Note that `customer.registered` has PII stripped from it (per sprint H.1 / ADR-0006); do not
      re-add the email to it.
      Write the use-case test, including the returning-guest case and the
      already-a-real-customer case.

- [ ] **T1.5 — Wire it into order creation.**
      `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts`: replace the throw.
      When `input.customerRef` is absent, call the new Identity use case with the session's contact
      email and use the returned id. The adapter currently takes only
      `Pick<OrderController, "createFromCheckout">` — extend its constructor dependency the same
      structural way (a `Pick<...>` of the identity controller), and update `wireAdmin` in
      `apps/admin/src/composition.ts` where the adapter is constructed.
      If the session has **no** contact email either, keep a throw — but make it a `DomainError`
      subclass with a clear message, not a plain `Error`, so the HTTP layer maps it to a 4xx
      instead of a 500. Check `packages/utils`' error taxonomy for the right one (`ValidationError`
      is likely correct: the caller can fix it by supplying an email).

- [ ] **T1.6 — Make the storefront collect the email.**
      `apps/storefront/src/app/checkout/page.tsx` and its `actions.ts`: add an email field to the
      checkout form and call the new contact route before completing. Follow the existing
      address-field pattern in that page exactly. Strings go in **both**
      `apps/storefront/src/messages/en.ts` and `ar.ts`. If the customer is logged in
      (`apps/storefront/src/lib/customer-session.ts` knows), pre-fill and do not require re-entry.

- [ ] **T1.7 — Un-fail the e2e spec.**
      `apps/e2e/tests/guest-purchase.spec.ts`: remove the `test.fail()` at line 44 and rewrite the
      module doc comment to describe what the flow now does. Extend the spec to assert the order
      was actually created and that the confirmation page shows it. **Read the doc comment before
      deleting it** — it explains that `test.fail()` was a forcing function, and that explanation
      should be replaced with what closed it, not simply removed.

- [ ] **T1.8 — Prove the guest cannot escalate.**
      Add a test asserting that completing a guest checkout with the email of an existing,
      registered customer does **not** give the guest session any read access to that customer's
      data — the guest session still has no customer identity, and
      `GET /public/auth/me` still reports unauthenticated. Put it next to the
      `public-checkout-routes` tests. This is the security half of the decision above and it is not
      optional.

## Definition of done

- [ ] A guest can go cart → checkout → confirmation in the running app, and an order exists
      afterwards. This is a Phase-2 exit criterion that has never been met.
- [ ] `apps/e2e/tests/guest-purchase.spec.ts` passes with no `test.fail()`.
- [ ] A returning guest reusing the same email attaches to the same customer id.
- [ ] T1.8's escalation test passes.
- [ ] `docs/plans/BLOCKERS.md`'s "T2.3" entry is updated with a dated note saying the C-2 limitation
      is closed and how. Do not delete it.
- [ ] `docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md`: G-52 closed.
- [ ] Repo-wide gates green (`pnpm -r --workspace-concurrency=4 run typecheck` and `run test`,
      plus `pnpm arch`).

## Known trap

The same adapter's doc comment (lines ~50–62) documents a **second, separate** known risk: a
concurrent-capture window between payment and order creation, with no shared transaction or
`checkoutRef`-keyed idempotency record. That is **out of scope** — do not try to fix it here, and
do not delete the comment describing it. If your change makes that window wider, say so in
`BLOCKERS.md`.
