"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import {
  advanceShipment,
  createShipment,
  createShipmentLabel,
  recordShipmentWebhook,
  retryShipment,
  updateShipmentTracking,
  voidShipmentLabel,
  type CreateShipmentPackageInput,
} from "@/lib/api/shipping";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * T5.4 — the Shipment detail screen's write actions (`app/orders/[orderId]/shipment/page.tsx`).
 * Same shape every write action in this app follows (`app/orders/[orderId]/fulfillment/actions.ts`'s
 * own doc comment, `apps/admin-web/README.md`'s recipe): parse `FormData` defensively (never trust
 * a hidden field or a closure variable), mint exactly one idempotency key per submit, call the
 * typed `lib/api/shipping.ts` function, and project any non-`ok` outcome through `toFormState`.
 *
 * Kept in this route's own `actions.ts` — Shipping is its own write surface with its own route
 * segment, same reasoning T5.3/T5.4's fulfillment actions used.
 */

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalStringField(formData: FormData, name: string): string | undefined {
  const value = stringField(formData, name);
  return value.length > 0 ? value : undefined;
}

async function formErrorDictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return dictionaryFor(locale).formErrors;
}

/** Both screens that show shipment data — the Order Detail card and this route's own page. */
function revalidateShipmentScreens(orderId: string): void {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/shipment`);
}

/**
 * Reads `ShipmentCreateForm`'s repeated package rows positionally — `getAll("packageReference")`/
 * `getAll("packageItemRefs")`/`getAll("packageWeightGrams")` are aligned by array index, the same
 * technique `app/orders/actions.ts`'s `parseLineItems` (T5.2) uses for `OrderLineItemsField`, since
 * this form has no per-row id to key by (unlike the item pickers in `parseFulfillmentCreateItems`/
 * `parseReturnCreateItems`, which pick from *existing* real records). `itemRefs` is entered as a
 * comma-separated list and split/trimmed here; an empty list (or a row missing any field) fails the
 * whole submit rather than silently dropping a package.
 */
function parseShipmentCreatePackages(
  formData: FormData,
): readonly CreateShipmentPackageInput[] | null {
  const references = formData.getAll("packageReference").map((v) => (typeof v === "string" ? v : ""));
  const itemRefsRaw = formData
    .getAll("packageItemRefs")
    .map((v) => (typeof v === "string" ? v : ""));
  const weights = formData
    .getAll("packageWeightGrams")
    .map((v) => (typeof v === "string" ? v : ""));

  if (references.length === 0 || references.length !== itemRefsRaw.length || references.length !== weights.length) {
    return null;
  }

  const packages: CreateShipmentPackageInput[] = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index] ?? "";
    const itemRefs = (itemRefsRaw[index] ?? "")
      .split(",")
      .map((ref) => ref.trim())
      .filter((ref) => ref.length > 0);
    const weightGrams = Number.parseInt(weights[index] ?? "", 10);
    if (reference.length === 0 || itemRefs.length === 0 || Number.isNaN(weightGrams) || weightGrams <= 0) {
      return null;
    }
    packages.push({ reference, itemRefs, weightGrams });
  }
  return packages;
}

/** Opens a shipment (`ShipmentCreateForm`, shown when `fetchShipmentByFulfillment` is `not_found`). */
export async function createShipmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const fulfillmentRef = stringField(formData, "fulfillmentRef");
  const packages = parseShipmentCreatePackages(formData);
  if (orderId.length === 0 || fulfillmentRef.length === 0 || packages === null) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: packages === null ? { packages: t.invalid } : {},
    };
  }

  const result = await createShipment({ fulfillmentRef, packages }, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Requests a label from the carrier (`LabelForm`, offered at `created`). */
export async function createShipmentLabelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  if (orderId.length === 0 || shipmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await createShipmentLabel(shipmentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Voids the shipment's label (`LabelVoidForm`, offered at `label_created`). */
export async function voidShipmentLabelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  if (orderId.length === 0 || shipmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await voidShipmentLabel(shipmentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Appends a carrier tracking scan (`TrackingForm`, offered at the "in motion" statuses). */
export async function updateShipmentTrackingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  const description = stringField(formData, "description");
  if (orderId.length === 0 || shipmentId.length === 0 || description.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: description.length === 0 ? { description: t.invalid } : {},
    };
  }
  const location = optionalStringField(formData, "location");

  const result = await updateShipmentTracking(
    shipmentId,
    { description, location },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Retries a shipment from a recoverable state (`RetryForm`, offered at `rejected`/`delivery_failed`/`exception`). */
export async function retryShipmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  if (orderId.length === 0 || shipmentId.length === 0) {
    return { status: "error", message: t.invalid, fieldErrors: {} };
  }

  const result = await retryShipment(shipmentId, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/** Records a carrier webhook (`WebhookForm`, offered at any non-terminal status). */
export async function recordShipmentWebhookAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  const carrier = stringField(formData, "carrier");
  const eventId = stringField(formData, "eventId");
  const kind = stringField(formData, "kind");
  if (
    orderId.length === 0 ||
    shipmentId.length === 0 ||
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

  const result = await recordShipmentWebhook(
    shipmentId,
    { carrier, eventId, kind },
    newIdempotencyKey(),
  );
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}

/**
 * Advances the shipment via the generic transitions route (`AdvanceForm`) — the fallback offered
 * whenever a residual (dedicated-uncovered) transition target exists
 * (`lib/shipping-lifecycle.ts`'s `advanceableShipmentStatusesFrom`).
 */
export async function advanceShipmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await formErrorDictionary();
  const orderId = stringField(formData, "orderId");
  const shipmentId = stringField(formData, "shipmentId");
  const toStatus = stringField(formData, "toStatus");
  if (orderId.length === 0 || shipmentId.length === 0 || toStatus.length === 0) {
    return {
      status: "error",
      message: t.invalid,
      fieldErrors: toStatus.length === 0 ? { toStatus: t.invalid } : {},
    };
  }

  const result = await advanceShipment(shipmentId, toStatus, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidateShipmentScreens(orderId);
    return { status: "success" };
  }
  return toFormState(result, t);
}
