"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  advanceOrder,
  createOrderFromCheckout,
  markOrderPaid,
  placeOrder,
  refundOrder,
  requestFulfillment,
  requestPaymentCapture,
  type OrderAddressInput,
  type OrderLineItemInput,
} from "@/lib/api/orders";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.2 — order write actions, following the exact shape `apps/products/actions.ts` established
 * (see that file's own doc comment): parse `FormData` defensively, mint one idempotency key,
 * call the typed `lib/api/orders.ts` function, and project any non-`ok` outcome through
 * `toFormState` — never a raw error message.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function stringFieldValues(formData: FormData, name: string): readonly string[] {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

/** Same repeated-field-array technique as `app/products/actions.ts`'s `parseVariants`, for order line items. */
function parseLineItems(formData: FormData): readonly OrderLineItemInput[] | null {
  const productIds = stringFieldValues(formData, "itemProductId");
  const names = stringFieldValues(formData, "itemName");
  const prices = stringFieldValues(formData, "itemUnitPriceAmountMinor");
  const quantities = stringFieldValues(formData, "itemQuantity");
  if (
    productIds.length === 0 ||
    productIds.length !== names.length ||
    productIds.length !== prices.length ||
    productIds.length !== quantities.length
  ) {
    return null;
  }
  const items: OrderLineItemInput[] = [];
  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index] ?? "";
    const name = names[index] ?? "";
    const unitPriceAmountMinor = Number.parseInt(prices[index] ?? "", 10);
    const quantity = Number.parseInt(quantities[index] ?? "", 10);
    if (
      productId.length === 0 ||
      name.length === 0 ||
      Number.isNaN(unitPriceAmountMinor) ||
      Number.isNaN(quantity)
    ) {
      return null;
    }
    items.push({ productId, name, unitPriceAmountMinor, quantity });
  }
  return items;
}

function parseAddress(formData: FormData, prefix: string): OrderAddressInput | null {
  const line1 = stringField(formData, `${prefix}Line1`);
  const city = stringField(formData, `${prefix}City`);
  const postalCode = stringField(formData, `${prefix}PostalCode`);
  const country = stringField(formData, `${prefix}Country`);
  if (line1.length === 0 || city.length === 0 || postalCode.length === 0 || country.length === 0) {
    return null;
  }
  return { line1, city, postalCode, country };
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Places a backoffice order (`app/orders/new`). */
export async function placeOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const customerRef = stringField(formData, "customerRef");
  const currency = stringField(formData, "currency");
  const items = parseLineItems(formData);
  const shippingAddress = parseAddress(formData, "shipping");

  if (
    customerRef.length === 0 ||
    currency.length === 0 ||
    items === null ||
    shippingAddress === null
  ) {
    const fieldErrors: Record<string, string> = {};
    if (customerRef.length === 0) fieldErrors["customerRef"] = t.invalid;
    if (currency.length === 0) fieldErrors["currency"] = t.invalid;
    if (items === null) fieldErrors["items"] = t.invalid;
    if (shippingAddress === null) fieldErrors["shippingAddress"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await placeOrder(
    { customerRef, currency, items, shippingAddress },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/orders");
    const id = result.data.id;
    redirect(id.length > 0 ? `/orders/${id}` : "/orders");
  }

  return toFormState(result, t);
}

/** Creates an order from a checkout session's snapshot (`app/orders/from-checkout`) — recovery path. */
export async function createOrderFromCheckoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();

  const checkoutRef = stringField(formData, "checkoutRef");
  const customerRef = stringField(formData, "customerRef");
  const currency = stringField(formData, "currency");
  const items = parseLineItems(formData);
  const billingAddress = parseAddress(formData, "billing");
  const shippingAddress = parseAddress(formData, "shipping");

  if (
    checkoutRef.length === 0 ||
    customerRef.length === 0 ||
    currency.length === 0 ||
    items === null ||
    billingAddress === null ||
    shippingAddress === null
  ) {
    const fieldErrors: Record<string, string> = {};
    if (checkoutRef.length === 0) fieldErrors["checkoutRef"] = t.invalid;
    if (customerRef.length === 0) fieldErrors["customerRef"] = t.invalid;
    if (currency.length === 0) fieldErrors["currency"] = t.invalid;
    if (items === null) fieldErrors["items"] = t.invalid;
    if (billingAddress === null) fieldErrors["billingAddress"] = t.invalid;
    if (shippingAddress === null) fieldErrors["shippingAddress"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await createOrderFromCheckout(
    { checkoutRef, customerRef, currency, items, billingAddress, shippingAddress },
    newIdempotencyKey(),
  );

  if (result.outcome === "ok") {
    revalidatePath("/orders");
    const id = result.data.id;
    redirect(id.length > 0 ? `/orders/${id}` : "/orders");
  }

  return toFormState(result, t);
}

// -- T5.2: the 5 order-detail lifecycle actions below share the exact shape
// `updateProductAction`/the T5.1 write routes established — parse `FormData` defensively (never
// trust a hidden field, re-derive the id from the submitted form), mint one idempotency key, call
// the typed `lib/api/orders.ts` function, `revalidatePath` the detail page on `ok`. ---------------

export async function refundOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  if (orderId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await refundOrder(orderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function advanceOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const toStatus = stringField(formData, "toStatus");
  if (orderId.length === 0 || toStatus.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: toStatus.length === 0 ? { toStatus: t.invalid } : {},
    };
  }

  const result = await advanceOrder(orderId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function markOrderPaidAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const paymentRef = stringField(formData, "paymentRef");
  if (orderId.length === 0 || paymentRef.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: paymentRef.length === 0 ? { paymentRef: t.invalid } : {},
    };
  }

  const result = await markOrderPaid(orderId, paymentRef, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function requestPaymentCaptureAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  if (orderId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await requestPaymentCapture(orderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}

export async function requestFulfillmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  if (orderId.length === 0) return { status: "error", message: t.invalid, fieldErrors: {} };

  const result = await requestFulfillment(orderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { status: "success" };
  }
  return toFormState(result, t);
}
