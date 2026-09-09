"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  CHECKOUT_SESSION_COOKIE,
  CHECKOUT_SESSION_COOKIE_OPTIONS,
  GUEST_SESSION_COOKIE,
} from "@/lib/cart";
import {
  completeCheckout as completeCheckoutApi,
  getCurrentCart,
  loadCheckoutItems,
  recalculateCheckout as recalculateCheckoutApi,
  requestCheckoutShippingQuote,
  requestCheckoutTax,
  selectCheckoutPayment,
  selectCheckoutShipping,
  setCheckoutBillingAddress,
  setCheckoutShippingAddress,
  startCheckout as startCheckoutApi,
  type CheckoutAddressInput,
  type ShippingQuoteSummary,
} from "@/lib/runtime-api";

/**
 * Guest Checkout Server Actions (Phase 2 — Public checkout). Every action is a Next.js Server
 * Action, exactly like `app/cart/actions.ts`: it runs on the server, so it is the only place the
 * guest session cookie is ever read, and the only place `morbeh_checkout_session` is ever written.
 * A Client Component calls these directly; it never sees or supplies a `sessionRef`.
 *
 * **Never mints a guest session here** (unlike `addToCart` in `app/cart/actions.ts`): a checkout
 * always begins from an existing cart, so a missing `GUEST_SESSION_COOKIE` is an ownership error,
 * not a reason to create one.
 */

export type CheckoutActionResult =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | {
      readonly ok: false;
      /** `"ownership"`: no session cookie, or the Runtime API 404'd (stale/cross-session cookie).
       * `"validation"`: the Runtime API 422'd. `"unavailable"`: the Runtime API 409'd (the session
       * can no longer be modified). `"network"`: unreachable or an unexpected status. */
      readonly reason: "ownership" | "validation" | "unavailable" | "network";
    };

/**
 * `requestShippingQuote` is the one step that returns data the session DTO doesn't carry (the
 * available methods/rates to choose from) — every other action's caller already has what it needs
 * to render the next step once `ok` is true.
 */
export type ShippingQuoteActionResult =
  | {
      readonly ok: true;
      readonly checkoutSessionId: string;
      readonly quotes: readonly ShippingQuoteSummary[];
    }
  | { readonly ok: false; readonly reason: "ownership" | "validation" | "unavailable" | "network" };

function mapFailureStatus(status: number): "ownership" | "validation" | "unavailable" | "network" {
  if (status === 404) return "ownership";
  if (status === 422) return "validation";
  if (status === 409) return "unavailable";
  return "network";
}

/** The existing guest session, if any — mirrors `existingSessionRef()` in `app/cart/actions.ts`. */
async function existingSessionRef(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(GUEST_SESSION_COOKIE)?.value;
}

/**
 * Runs a mutating checkout call: resolves the guest session, returns `"ownership"` if there is
 * none, otherwise runs `call` and maps its status to a `CheckoutActionResult`, revalidating
 * `/checkout` on success.
 */
async function withSession(
  checkoutSessionId: string,
  call: (sessionRef: string) => Promise<{ readonly status: number; readonly body: unknown }>,
): Promise<CheckoutActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const response = await call(sessionRef);
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: mapFailureStatus(response.status) };
  }
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

/**
 * Starts a checkout session for the caller's own current cart and immediately loads its item
 * snapshot (`POST .../items`) — the stepper (`checkout-view.tsx`) begins at the shipping-address
 * step, so items must already be on the session by the time `/checkout` first renders, and
 * `startCheckout` is the only place both the new `checkoutSessionId` and the `cartId` are in scope
 * together. `cartId` comes from `/cart`, which already has it; the currency is re-read from the
 * current cart itself rather than trusted from a caller-supplied argument.
 */
export async function startCheckout(cartId: string): Promise<CheckoutActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const current = await getCurrentCart(sessionRef);
  if (
    current.status < 200 ||
    current.status >= 300 ||
    current.body === null ||
    current.body.cart === null
  ) {
    return { ok: false, reason: "network" };
  }

  const started = await startCheckoutApi(sessionRef, cartId, current.body.cart.currency);
  if (started.status < 200 || started.status >= 300 || started.body === null) {
    return { ok: false, reason: mapFailureStatus(started.status) };
  }
  const checkoutSessionId = started.body.id;

  const withItems = await loadCheckoutItems(checkoutSessionId, sessionRef, cartId);
  if (withItems.status < 200 || withItems.status >= 300) {
    return { ok: false, reason: mapFailureStatus(withItems.status) };
  }

  const jar = await cookies();
  jar.set(CHECKOUT_SESSION_COOKIE, checkoutSessionId, CHECKOUT_SESSION_COOKIE_OPTIONS);
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

export async function setShippingAddress(
  checkoutSessionId: string,
  address: CheckoutAddressInput,
): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    setCheckoutShippingAddress(checkoutSessionId, sessionRef, address),
  );
}

export async function setBillingAddress(
  checkoutSessionId: string,
  address: CheckoutAddressInput,
): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    setCheckoutBillingAddress(checkoutSessionId, sessionRef, address),
  );
}

export async function requestShippingQuote(
  checkoutSessionId: string,
): Promise<ShippingQuoteActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const response = await requestCheckoutShippingQuote(checkoutSessionId, sessionRef);
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return { ok: false, reason: mapFailureStatus(response.status) };
  }
  return { ok: true, checkoutSessionId, quotes: response.body.quotes };
}

export async function selectShipping(
  checkoutSessionId: string,
  method: string,
): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    selectCheckoutShipping(checkoutSessionId, sessionRef, method),
  );
}

export async function requestTax(checkoutSessionId: string): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    requestCheckoutTax(checkoutSessionId, sessionRef),
  );
}

export async function selectPayment(
  checkoutSessionId: string,
  paymentMethodRef: string,
  provider: string,
): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    selectCheckoutPayment(checkoutSessionId, sessionRef, paymentMethodRef, provider),
  );
}

export async function recalculate(checkoutSessionId: string): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    recalculateCheckoutApi(checkoutSessionId, sessionRef),
  );
}

/**
 * Completes the checkout session. The idempotency key is generated here, server-side, on every
 * call (a retry from the client gets a NEW key) — the real replay protection is the
 * `Idempotency-Key` HTTP header `completeCheckoutApi` sends, enforced centrally by the transport;
 * see the C-2 note on `runtime-api.ts`'s `completeCheckout`.
 *
 * Leaves `CHECKOUT_SESSION_COOKIE` in place on success — `/checkout/confirmation` still needs it to
 * know which session to render. It clears the cookie itself once it has rendered (see that page's
 * own comment for why the responsibility sits there and not here).
 */
export async function completeCheckout(checkoutSessionId: string): Promise<CheckoutActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const idempotencyKey = crypto.randomUUID();
  const response = await completeCheckoutApi(checkoutSessionId, sessionRef, idempotencyKey);
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: mapFailureStatus(response.status) };
  }
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

/** Clears the checkout-session cookie — called once by `/checkout/confirmation` after it renders. */
export async function clearCheckoutSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(CHECKOUT_SESSION_COOKIE);
}
