"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  CHECKOUT_SESSION_COOKIE,
  CHECKOUT_SESSION_COOKIE_OPTIONS,
  GUEST_SESSION_COOKIE,
} from "@/lib/cart";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import { readTrackingSnapshot } from "@/lib/tracking-snapshot";
import {
  applyCheckoutDiscountCode,
  completeCheckout as completeCheckoutApi,
  getCurrentCart,
  initiateCheckoutPayment,
  loadCheckoutItems,
  recalculateCheckout as recalculateCheckoutApi,
  removeCheckoutDiscountCode,
  requestCheckoutShippingQuote,
  requestCheckoutTax,
  selectCheckoutPayment,
  selectCheckoutShipping,
  setCheckoutBillingAddress,
  setCheckoutContact,
  setCheckoutShippingAddress,
  startCheckout as startCheckoutApi,
  type CheckoutAddressInput,
  type ShippingQuoteSummary,
} from "@/lib/runtime-api";

/**
 * Guest Checkout Server Actions (Phase 2 — Public checkout). Every action is a Next.js Server
 * Action, exactly like `app/(store)/cart/actions.ts`: it runs on the server, so it is the only place the
 * guest session cookie is ever read, and the only place `morbeh_checkout_session` is ever written.
 * A Client Component calls these directly; it never sees or supplies a `sessionRef`.
 *
 * **Never mints a guest session here** (unlike `addToCart` in `app/(store)/cart/actions.ts`): a checkout
 * always begins from an existing cart, so a missing `GUEST_SESSION_COOKIE` is an ownership error,
 * not a reason to create one.
 */

/** One field the server refused on a 422 (`fields: [{ field, message }]`), message as the server wrote it. */
export interface CheckoutFieldError {
  readonly field: string;
  readonly message: string;
}

export type CheckoutActionResult =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | {
      readonly ok: false;
      /** Wave 2a: on `"validation"`, the fields the server named (name, phone, line2, quantity), when it did. */
      readonly fields?: readonly CheckoutFieldError[];
      /** `"ownership"`: no session cookie, or the Runtime API 404'd (stale/cross-session cookie).
       * `"validation"`: the Runtime API 422'd. `"unavailable"`: the Runtime API 409'd (the session
       * can no longer be modified). `"out-of-stock"` (Plan 2B-3): completion refused because a line
       * is not in stock in the chosen quantity. `"draft-locked"` (order operations Part 4): the
       * discount or shipping of an invoice checkout was fixed by the merchant (409 `DRAFT_LOCKED`).
       * `"discounts-changed"` (Discounts Part 3): completion refused because the discounts no longer
       * give the total the shopper reviewed; the session was revalidated, so the new total is on screen.
       * `"login-required"` (Wave 2a): the shop only takes orders from signed-in customers (403
       * `LOGIN_REQUIRED`).
       * `"network"`: unreachable or an unexpected status. */
      readonly reason:
        | "ownership"
        | "validation"
        | "unavailable"
        | "out-of-stock"
        | "draft-locked"
        | "discounts-changed"
        | "login-required"
        | "network";
    };

/**
 * What happens after `applyDiscountCode`. `"rejected"` carries the runtime's stable reason token
 * (`minimum_not_met`, `expired`, …) for the caller to word; the other reasons are as in
 * `CheckoutActionResult`.
 */
export type DiscountCodeActionResult =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | { readonly ok: false; readonly reason: "rejected"; readonly rejection: string }
  | { readonly ok: false; readonly reason: "ownership" | "validation" | "unavailable" | "network" };

/** What the applied discounts take off the items (`order`) and off the shipping, in minor units. */
export interface CheckoutDiscountFigures {
  readonly order: number;
  readonly shipping: number;
}

/**
 * What happens after `recalculate`. On success it carries the discount figures the runtime just
 * computed — `null` when the response did not say (an older API, an unreadable body) — so placing
 * the order can stop before completion when they differ from what the shopper reviewed.
 */
export type RecalculateActionResult =
  | {
      readonly ok: true;
      readonly checkoutSessionId: string;
      readonly discounts: CheckoutDiscountFigures | null;
    }
  | { readonly ok: false; readonly reason: "ownership" | "validation" | "unavailable" | "network" };

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

/**
 * What happens after `initiatePayment`. The outcomes are explicit so the caller can never mistake
 * "nothing to redirect to" for "nothing to do": `"confirmation"` (an offline method — the order
 * stands and is paid out of band) or `"redirect"` (a hosted checkout the shopper MUST be sent to).
 * `"handoff"` is the failure where a redirect was required and could not be produced.
 */
export type PaymentInitiationResult =
  | { readonly ok: true; readonly next: "confirmation" }
  | { readonly ok: true; readonly next: "redirect"; readonly url: string }
  | {
      readonly ok: false;
      readonly reason: "ownership" | "validation" | "unavailable" | "network" | "handoff";
    };

/**
 * Providers with no hosted page and no client handle: the shopper pays offline. Everything NOT in
 * this set — including a provider this file has never heard of — must return a usable https handle
 * or the result is `"handoff"`, so a new hosted method can never silently fall through to
 * "confirmation" as if it were paid.
 */
const OFFLINE_PROVIDERS: ReadonlySet<string> = new Set(["cod"]);

function hostedCheckoutUrl(clientHandle: string | undefined): string | null {
  if (clientHandle === undefined) return null;
  try {
    const url = new URL(clientHandle);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapFailureStatus(status: number): "ownership" | "validation" | "unavailable" | "network" {
  if (status === 404) return "ownership";
  if (status === 422) return "validation";
  if (status === 409) return "unavailable";
  return "network";
}

function isOutOfStock(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { message, code } = body as { readonly message?: unknown; readonly code?: unknown };
  return (
    code === "OUT_OF_STOCK" || (typeof message === "string" && message.startsWith("OUT_OF_STOCK:"))
  );
}

/** A 409 with the code Checkout gives a refusal to change what the merchant fixed on a draft order. */
function isDraftLocked(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { readonly code?: unknown }).code === "DRAFT_LOCKED"
  );
}

/** A 403 with the code the server gives a guest when the shop requires sign-in to check out. */
function isLoginRequired(response: { readonly status: number; readonly body: unknown }): boolean {
  return (
    response.status === 403 &&
    typeof response.body === "object" &&
    response.body !== null &&
    (response.body as { readonly code?: unknown }).code === "LOGIN_REQUIRED"
  );
}

/**
 * The `{ field, message }` pairs of a 422 envelope. Messages are the server's own words and are
 * only ever shown through the dictionary for the fields the form knows; anything else is dropped.
 */
function fieldErrors(body: unknown): readonly CheckoutFieldError[] {
  if (typeof body !== "object" || body === null) return [];
  const { fields } = body as { readonly fields?: unknown };
  if (!Array.isArray(fields)) return [];
  const found: CheckoutFieldError[] = [];
  for (const entry of fields as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { field, message } = entry as { readonly field?: unknown; readonly message?: unknown };
    if (typeof field === "string" && field !== "" && typeof message === "string") {
      found.push({ field, message });
    }
  }
  return found;
}

/** The reason for a failed mutating call; only a 409 body is ever read (never echoed). */
function mutationFailure(response: {
  readonly status: number;
  readonly body: unknown;
}): "ownership" | "validation" | "unavailable" | "draft-locked" | "login-required" | "network" {
  if (response.status === 409 && isDraftLocked(response.body)) return "draft-locked";
  if (isLoginRequired(response)) return "login-required";
  return mapFailureStatus(response.status);
}

/** A failed call as the action reports it: the reason, plus the named fields of a 422 when there are any. */
function failure(response: {
  readonly status: number;
  readonly body: unknown;
}): Extract<CheckoutActionResult, { readonly ok: false }> {
  const reason = mutationFailure(response);
  if (reason === "validation") {
    const fields = fieldErrors(response.body);
    if (fields.length > 0) return { ok: false, reason, fields };
  }
  return { ok: false, reason };
}

/** The signed-in customer's session id (opaque, from the HttpOnly cookie), or `undefined` for a guest. */
async function customerSessionId(): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(CUSTOMER_SESSION_COOKIE)?.value;
  return value !== undefined && value.length > 0 ? value : undefined;
}

function isDiscountsChanged(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { message } = body as { readonly message?: unknown };
  return typeof message === "string" && message.startsWith("DISCOUNTS_CHANGED:");
}

/** The reason token of a 422 about the `code` field, or `null` for any other envelope. */
function codeRejection(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { fields } = body as { readonly fields?: unknown };
  if (!Array.isArray(fields)) return null;
  const first: unknown = fields[0];
  if (typeof first !== "object" || first === null) return null;
  const { field, message } = first as { readonly field?: unknown; readonly message?: unknown };
  return field === "code" && typeof message === "string" && message !== "" ? message : null;
}

/** The discount figures of a session DTO's totals, or `null` unless both are plain numbers. */
function discountFigures(body: unknown): CheckoutDiscountFigures | null {
  if (typeof body !== "object" || body === null) return null;
  const { totals } = body as { readonly totals?: unknown };
  if (typeof totals !== "object" || totals === null) return null;
  const { discountMinor, shippingDiscountMinor } = totals as {
    readonly discountMinor?: unknown;
    readonly shippingDiscountMinor?: unknown;
  };
  if (typeof discountMinor !== "number" || !Number.isFinite(discountMinor)) return null;
  if (typeof shippingDiscountMinor !== "number" || !Number.isFinite(shippingDiscountMinor)) {
    return null;
  }
  return { order: discountMinor, shipping: shippingDiscountMinor };
}

/** The existing guest session, if any — mirrors `existingSessionRef()` in `app/(store)/cart/actions.ts`. */
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
  if (response.status < 200 || response.status >= 300) return failure(response);
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

/**
 * Applies a discount code the shopper typed. Only the trimmed code is sent — never an amount — and
 * the runtime answers a code it will not take with a 422 whose first field error is the `code`
 * field and whose message is the reason token. A blank code is refused here, without a call.
 */
export async function applyDiscountCode(
  checkoutSessionId: string,
  code: string,
): Promise<DiscountCodeActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };
  const trimmed = code.trim();
  if (trimmed === "") return { ok: false, reason: "validation" };

  const response = await applyCheckoutDiscountCode(checkoutSessionId, sessionRef, trimmed);
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 422) {
      const rejection = codeRejection(response.body);
      if (rejection !== null) {
        // Re-entering a code the session already holds and that no longer applies makes the
        // runtime drop it, so the chips can be stale: refresh them along with the message.
        revalidatePath("/checkout");
        return { ok: false, reason: "rejected", rejection };
      }
    }
    return { ok: false, reason: mapFailureStatus(response.status) };
  }
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

export async function removeDiscountCode(
  checkoutSessionId: string,
  code: string,
): Promise<CheckoutActionResult> {
  return withSession(checkoutSessionId, (sessionRef) =>
    removeCheckoutDiscountCode(checkoutSessionId, sessionRef, code),
  );
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

  // Wave 2a: a shop that requires sign-in wants the customer's session on create (and on complete).
  const customerSession = await customerSessionId();
  const started =
    customerSession === undefined
      ? await startCheckoutApi(sessionRef, cartId, current.body.cart.currency)
      : await startCheckoutApi(sessionRef, cartId, current.body.cart.currency, customerSession);
  if (started.status < 200 || started.status >= 300 || started.body === null) {
    return failure(started);
  }
  const checkoutSessionId = started.body.id;

  const withItems = await loadCheckoutItems(checkoutSessionId, sessionRef, cartId);
  if (withItems.status < 200 || withItems.status >= 300) return failure(withItems);

  const jar = await cookies();
  jar.set(CHECKOUT_SESSION_COOKIE, checkoutSessionId, CHECKOUT_SESSION_COOKIE_OPTIONS);
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

/**
 * Records where a guest's receipt goes (WP-1, G-52). At completion the Runtime API resolves — finds
 * or creates — a guest customer from it, so the order has a customer to attach to. Like every
 * action here, the `sessionRef` is the server-held guest cookie, never a caller-supplied value; the
 * email itself proves nothing about identity and never signs anyone in.
 */
export async function setContactEmail(
  checkoutSessionId: string,
  email: string,
  marketingOptIn?: boolean,
): Promise<CheckoutActionResult> {
  // Wave 2a: the answer is sent only when the shop showed the box (the caller passes it then).
  return withSession(checkoutSessionId, (sessionRef) =>
    marketingOptIn === undefined
      ? setCheckoutContact(checkoutSessionId, sessionRef, email)
      : setCheckoutContact(checkoutSessionId, sessionRef, email, marketingOptIn),
  );
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

/**
 * Recalculates the totals. The runtime answers with the session, so the result also carries the
 * discount figures it just computed (see `RecalculateActionResult`); callers that only need
 * `ok`/`reason` can ignore them.
 */
export async function recalculate(checkoutSessionId: string): Promise<RecalculateActionResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const response = await recalculateCheckoutApi(checkoutSessionId, sessionRef);
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: mapFailureStatus(response.status) };
  }
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId, discounts: discountFigures(response.body) };
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
  const customerSession = await customerSessionId();
  // Tracking P2-D8: the attribution snapshot comes from the server-side cookie jar and request headers ONLY — this
  // action takes no tracking argument, so nothing a client sends can name the visitor or their click ids. A request
  // that carried nothing (or a failed read) completes exactly as before.
  const tracking = await readTrackingSnapshot();
  const response =
    tracking !== undefined
      ? await completeCheckoutApi(
          checkoutSessionId,
          sessionRef,
          idempotencyKey,
          customerSession,
          tracking,
        )
      : customerSession === undefined
        ? await completeCheckoutApi(checkoutSessionId, sessionRef, idempotencyKey)
        : await completeCheckoutApi(checkoutSessionId, sessionRef, idempotencyKey, customerSession);
  if (response.status < 200 || response.status >= 300) {
    // Plan 2B-3: the API refuses a completion whose stock is not there with a 409 whose message
    // starts `OUT_OF_STOCK:` — a different outcome from "the session can no longer be modified".
    if (response.status === 409 && isOutOfStock(response.body)) {
      return { ok: false, reason: "out-of-stock" };
    }
    // Discounts Part 3: the discounts no longer give the total the shopper reviewed. The session's
    // totals changed, so refresh them before the caller shows the notice.
    if (response.status === 409 && isDiscountsChanged(response.body)) {
      revalidatePath("/checkout");
      return { ok: false, reason: "discounts-changed" };
    }
    return failure(response);
  }
  revalidatePath("/checkout");
  return { ok: true, checkoutSessionId };
}

/**
 * Opens the payment for the checkout `completeCheckout` just completed — it MUST run after it (the
 * API refuses an uncompleted session: `InitiatePayment` requires `orderRef`). Sends no provider:
 * the API reads the selection the shopper made off the session. Never re-completes the order, so a
 * failed initiation is retried by calling only this.
 */
export async function initiatePayment(checkoutSessionId: string): Promise<PaymentInitiationResult> {
  const sessionRef = await existingSessionRef();
  if (sessionRef === undefined) return { ok: false, reason: "ownership" };

  const response = await initiateCheckoutPayment(checkoutSessionId, sessionRef);
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    return { ok: false, reason: mapFailureStatus(response.status) };
  }

  if (OFFLINE_PROVIDERS.has(response.body.provider)) return { ok: true, next: "confirmation" };
  const url = hostedCheckoutUrl(response.body.clientHandle);
  if (url === null) return { ok: false, reason: "handoff" };
  return { ok: true, next: "redirect", url };
}

/** Clears the checkout-session cookie — called once by `/checkout/confirmation` after it renders. */
export async function clearCheckoutSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(CHECKOUT_SESSION_COOKIE);
}
