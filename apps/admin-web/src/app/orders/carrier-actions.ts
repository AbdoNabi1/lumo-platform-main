"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { MutationResult } from "@/lib/api/client";
import {
  cancelCarrierShipment,
  shipOrdersWithCarrier,
  shipOrderWithCarrier,
} from "@/lib/api/carrier-shipments";
import { newIdempotencyKey, type FormState } from "@/lib/api/mutation";
import { retryShipment } from "@/lib/api/shipping";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { CARRIER_KEY, carrierErrorMessage } from "@/lib/shipping/carrier-errors";
import type { Dictionary } from "@/messages/en";

export type ShipActionResult =
  | { readonly status: "success"; readonly trackingNumber: string }
  | { readonly status: "error"; readonly message: string };

type BulkShipActionResult =
  | {
      readonly status: "success";
      readonly shipped: number;
      readonly failed: readonly { orderId: string; orderNumber?: string; message: string }[];
    }
  | { readonly status: "error"; readonly message: string };

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_BULK = 50;

async function dictionary(): Promise<Dictionary> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isCarrierKey(value: unknown): value is string {
  return typeof value === "string" && CARRIER_KEY.test(value);
}

function isIdList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_BULK &&
    value.every(isId) &&
    new Set(value).size === value.length
  );
}

/** The localised reason for any non-ok write; carrier codes get their own Egyptian sentence. */
function failureMessage(
  result: Exclude<MutationResult<unknown>, { outcome: "ok" }>,
  t: Dictionary,
): string {
  switch (result.outcome) {
    case "unauthorized":
      return t.formErrors.unauthorized;
    case "forbidden":
      return t.formErrors.forbidden;
    case "not_found":
      return t.formErrors.notFound;
    case "invalid":
      return result.code !== undefined && result.code !== "VALIDATION"
        ? carrierErrorMessage(result.code, t)
        : t.formErrors.invalid;
    case "conflict":
      return result.code === undefined
        ? t.formErrors.conflict
        : carrierErrorMessage(result.code, t);
    case "error":
      return result.code === undefined
        ? t.formErrors.unexpected
        : carrierErrorMessage(result.code, t);
  }
}

function revalidateOrder(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

async function shipOne(
  orderId: string,
  carrierKey: string,
  t: Dictionary,
): Promise<ShipActionResult> {
  const result = await shipOrderWithCarrier(orderId, carrierKey, newIdempotencyKey());
  // Any answer from the API may have changed server state (CARRIER_RESULT_UNKNOWN persists a
  // review-required shipment), so the screens refresh on ok and non-ok alike.
  revalidateOrder(orderId);
  if (result.outcome === "ok") {
    return { status: "success", trackingNumber: result.data.trackingNumber };
  }
  return { status: "error", message: failureMessage(result, t) };
}

export async function shipWithCarrierAction(
  orderId: string,
  carrierKey: string,
): Promise<ShipActionResult> {
  const t = await dictionary();
  try {
    if (!isId(orderId) || !isCarrierKey(carrierKey)) {
      return { status: "error", message: t.formErrors.invalid };
    }
    return await shipOne(orderId, carrierKey, t);
  } catch (caught) {
    unstable_rethrow(caught);
    return { status: "error", message: t.formErrors.unexpected };
  }
}

export async function bulkShipWithCarrierAction(
  orderIds: readonly string[],
  carrierKey: string,
): Promise<BulkShipActionResult> {
  const t = await dictionary();
  try {
    if (!isIdList(orderIds) || !isCarrierKey(carrierKey)) {
      return { status: "error", message: t.formErrors.invalid };
    }
    const result = await shipOrdersWithCarrier(orderIds, carrierKey, newIdempotencyKey());
    revalidatePath("/orders");
    for (const orderId of orderIds) revalidatePath(`/orders/${orderId}`);
    if (result.outcome !== "ok") return { status: "error", message: failureMessage(result, t) };
    return {
      status: "success",
      shipped: result.data.shipped.length,
      failed: result.data.failed.map((failure) => ({
        orderId: failure.orderId,
        ...(failure.orderNumber === undefined ? {} : { orderNumber: failure.orderNumber }),
        message: carrierErrorMessage(failure.code, t),
      })),
    };
  } catch (caught) {
    unstable_rethrow(caught);
    return { status: "error", message: t.formErrors.unexpected };
  }
}

export async function cancelCarrierShipmentAction(
  orderId: string,
  shipmentId: string,
): Promise<FormState> {
  const t = await dictionary();
  try {
    if (!isId(orderId) || !isId(shipmentId)) {
      return { status: "error", message: t.formErrors.invalid, fieldErrors: {} };
    }
    const result = await cancelCarrierShipment(shipmentId, newIdempotencyKey());
    revalidateOrder(orderId);
    if (result.outcome === "ok") return { status: "success" };
    return { status: "error", message: failureMessage(result, t), fieldErrors: {} };
  } catch (caught) {
    unstable_rethrow(caught);
    return { status: "error", message: t.formErrors.unexpected, fieldErrors: {} };
  }
}

/** "I checked Bosta — ship again": retry the stuck shipment (Ruling 42), then ship. */
export async function retryCarrierShipmentAction(
  orderId: string,
  shipmentId: string,
  carrierKey: string,
): Promise<ShipActionResult> {
  const t = await dictionary();
  try {
    if (!isId(orderId) || !isId(shipmentId) || !isCarrierKey(carrierKey)) {
      return { status: "error", message: t.formErrors.invalid };
    }
    const retried = await retryShipment(shipmentId, newIdempotencyKey());
    revalidateOrder(orderId);
    if (retried.outcome !== "ok") return { status: "error", message: failureMessage(retried, t) };
    return await shipOne(orderId, carrierKey, t);
  } catch (caught) {
    unstable_rethrow(caught);
    return { status: "error", message: t.formErrors.unexpected };
  }
}
