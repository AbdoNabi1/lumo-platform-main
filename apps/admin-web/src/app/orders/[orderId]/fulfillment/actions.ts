"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  advanceFulfillment,
  createFulfillment,
  recordFulfillmentWebhook,
  reserveFulfillment,
  shipFulfillment,
  type CreateFulfillmentItemInput,
} from "@/lib/api/fulfillment";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.4 — the Fulfillment detail screen's write actions
 * (`app/orders/[orderId]/fulfillment/page.tsx`). Same shape every write action in this app follows
 * (`app/orders/[orderId]/returns/actions.ts`'s own T5.3 doc comment, `apps/admin-web/README.md`'s
 * recipe): parse `FormData` defensively (never trust a hidden field or a closure variable —
 * re-derive `orderId`/`fulfillmentOrderId` from the submission itself), mint exactly one
 * idempotency key per submit, call the typed `lib/api/fulfillment.ts` function, and project any
 * non-`ok` outcome through `toFormState`.
 *
 * Kept in this route's own `actions.ts` (not `app/orders/actions.ts`), same reasoning T5.3 used for
 * Returns — Fulfillment is its own write surface with its own route segment.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show fulfillment data — the Order Detail card and this route's own page. */
function revalidateFulfillmentScreens(orderId: string): void {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/fulfillment`);
  // The Shipping panel/screen resolve through the fulfillment order, so a fulfillment write can
  // change what they show (e.g. once a fulfillment order first exists).
  revalidatePath(`/orders/${orderId}/shipment`);
}

/**
 * Reads the checked order items off `FulfillmentCreateForm`'s `includeItem` checkboxes (their
 * values are the included item ids directly) and, for each one, its companion
 * `productRef_<id>`/`quantity_<id>` fields, keyed explicitly by that same id rather than by array
 * position — same discipline as `returns/actions.ts`'s `parseReturnCreateItems`.
 */
function parseFulfillmentCreateItems(
  formData: FormData,
): readonly CreateFulfillmentItemInput[] | null {
  const includedIds = formData
    .getAll("includeItem")
    .map((value) => (typeof value === "string" ? value : ""));
  if (includedIds.length === 0) return null;

  const items: CreateFulfillmentItemInput[] = [];
  for (const id of includedIds) {
    if (id.length === 0) return null;
    const productRef = stringField(formData, `productRef_${id}`);
    const quantity = Number.parseInt(stringField(formData, `quantity_${id}`), 10);
    if (productRef.length === 0 || Number.isNaN(quantity) || quantity <= 0) {
      return null;
    }
    items.push({ productRef, quantity });
  }
  return items;
}

/** Opens a fulfillment order (`FulfillmentCreateForm`, shown when `fetchFulfillmentByOrder` is `not_found`). */
export async function createFulfillmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderRef = stringField(formData, "orderRef");
  const items = parseFulfillmentCreateItems(formData);
  if (orderRef.length === 0 || items === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: items === null ? { items: t.invalid } : {},
    };
  }

  const result = await createFulfillment({ orderRef, items }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFulfillmentScreens(orderRef);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Requests a stock reservation (`ReserveForm`, offered at `created`/`failed`). */
export async function reserveFulfillmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const fulfillmentOrderId = stringField(formData, "fulfillmentOrderId");
  if (orderId.length === 0 || fulfillmentOrderId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await reserveFulfillment(fulfillmentOrderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFulfillmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Requests a shipment from the carrier (`ShipForm`, offered at `packing_completed`). */
export async function shipFulfillmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const fulfillmentOrderId = stringField(formData, "fulfillmentOrderId");
  if (orderId.length === 0 || fulfillmentOrderId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await shipFulfillment(fulfillmentOrderId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFulfillmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records a carrier webhook (`WebhookForm`, offered at any non-terminal status). */
export async function recordFulfillmentWebhookAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const fulfillmentOrderId = stringField(formData, "fulfillmentOrderId");
  const carrier = stringField(formData, "carrier");
  const eventId = stringField(formData, "eventId");
  const kind = stringField(formData, "kind");
  if (
    orderId.length === 0 ||
    fulfillmentOrderId.length === 0 ||
    carrier.length === 0 ||
    eventId.length === 0 ||
    kind.length === 0
  ) {
    const fieldErrors: Record<string, string> = {};
    if (carrier.length === 0) fieldErrors["carrier"] = t.invalid;
    if (eventId.length === 0) fieldErrors["eventId"] = t.invalid;
    if (kind.length === 0) fieldErrors["kind"] = t.invalid;
    return { status: "error", message: t.invalid, fieldErrors };
  }

  const result = await recordFulfillmentWebhook(
    fulfillmentOrderId,
    { carrier, eventId, kind },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateFulfillmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances the fulfillment order via the generic transitions route (`AdvanceForm`) — the fallback
 * offered whenever a residual (dedicated-uncovered) transition target exists
 * (`lib/fulfillment-lifecycle.ts`'s `advanceableFulfillmentStatusesFrom`).
 */
export async function advanceFulfillmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const fulfillmentOrderId = stringField(formData, "fulfillmentOrderId");
  const toStatus = stringField(formData, "toStatus");
  if (orderId.length === 0 || fulfillmentOrderId.length === 0 || toStatus.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: toStatus.length === 0 ? { toStatus: t.invalid } : {},
    };
  }

  const result = await advanceFulfillment(fulfillmentOrderId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateFulfillmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}
