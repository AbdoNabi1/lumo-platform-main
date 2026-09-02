import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface FulfillmentItemDto {
  readonly productRef: string;
  readonly quantity: number;
}

export interface FulfillmentDetailDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly items: readonly FulfillmentItemDto[];
  readonly carrier: string | null;
  readonly carrierShipmentId: string | null;
  readonly trackingNumber: string | null;
  readonly deliveredAt: string | null;
  readonly packages: readonly {
    readonly reference: string;
    readonly itemRefs: readonly string[];
    readonly weightGrams: number;
  }[];
}

function isFulfillmentDetailDto(value: unknown): value is FulfillmentDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchFulfillmentResult =
  | { readonly outcome: "ok"; readonly fulfillment: FulfillmentDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches the fulfillment order opened for an order, if any (Order Detail screen). */
export async function fetchFulfillmentByOrder(orderId: string): Promise<FetchFulfillmentResult> {
  const result = await getAdminApi(
    `/api/v1/orders/${encodeURIComponent(orderId)}/fulfillment`,
    isFulfillmentDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", fulfillment: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

/**
 * T5.4 — the 5 fulfillment write routes below (`fulfillment-routes.ts`). None of their handlers
 * map the response through a DTO (each is a plain `return admin.fulfillment.<x>(...)` — only
 * `getByOrder` above calls `toFulfillmentDetailDto`), so exactly like `returns.ts`'s non-DTO write
 * functions, every one of these reads nothing off the response body — `isUnknown` only checks the
 * call succeeded. Callers `revalidatePath` the fulfillment detail page afterwards, which re-fetches
 * the real, DTO-mapped state via `fetchFulfillmentByOrder`.
 */
function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function fulfillmentPath(fulfillmentOrderId: string, suffix: string): string {
  return `/api/v1/fulfillments/${encodeURIComponent(fulfillmentOrderId)}${suffix}`;
}

export interface CreateFulfillmentItemInput {
  readonly productRef: string;
  readonly quantity: number;
}

export interface CreateFulfillmentInput {
  readonly orderRef: string;
  readonly items: readonly CreateFulfillmentItemInput[];
}

/**
 * Opens a fulfillment order for an order's items (`POST /fulfillments`, `idempotent: true`,
 * `fulfillment:create`). The created fulfillment order is keyed by `orderRef`, not returned here —
 * the caller re-fetches it via `fetchFulfillmentByOrder`, same as every other write below.
 */
export function createFulfillment(
  input: CreateFulfillmentInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/fulfillments",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/**
 * Advances a fulfillment order to any status its current status's transition table allows (`POST
 * /fulfillments/:fulfillmentOrderId/transitions`, `idempotent: true`, `fulfillment:advance`) — the
 * fallback for the transition targets with no dedicated action
 * (`lib/fulfillment-lifecycle.ts`'s `advanceableFulfillmentStatusesFrom`).
 */
export function advanceFulfillment(
  fulfillmentOrderId: string,
  toStatus: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    fulfillmentPath(fulfillmentOrderId, "/transitions"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Requests a stock reservation via the InventoryPort (`POST
 * /fulfillments/:fulfillmentOrderId/reserve`, `idempotent: false`, `fulfillment:reserve`).
 * `mutateAdminApi` always sends the `Idempotency-Key` header when a key is passed, regardless of
 * the route's own `idempotent` flag (see `lib/api/client.ts`) — the caller still mints exactly one
 * key per submit per this app's own rule; the backend simply won't dedupe replays by it for this
 * route.
 */
export function reserveFulfillment(
  fulfillmentOrderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    fulfillmentPath(fulfillmentOrderId, "/reserve"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/**
 * Requests a shipment from the carrier via the ShippingProviderPort (`POST
 * /fulfillments/:fulfillmentOrderId/shipments`, `idempotent: true`, `fulfillment:ship`). Distinct
 * from Shipping's own `createShipment` (`lib/api/shipping.ts`, `POST /shipments`) — this route asks
 * Fulfillment to request one from the carrier with no body; Shipping's `createShipment` is the
 * separate write that opens the `Shipment` aggregate itself with an explicit package list.
 */
export function shipFulfillment(
  fulfillmentOrderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    fulfillmentPath(fulfillmentOrderId, "/shipments"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

export interface RecordFulfillmentWebhookInput {
  readonly carrier: string;
  readonly eventId: string;
  readonly kind: string;
}

/**
 * Records a carrier webhook (replay-safe) (`POST /fulfillments/:fulfillmentOrderId/webhook`,
 * `idempotent: false`, `fulfillment:record_webhook`). Same `Idempotency-Key` note as
 * `reserveFulfillment` above.
 */
export function recordFulfillmentWebhook(
  fulfillmentOrderId: string,
  input: RecordFulfillmentWebhookInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    fulfillmentPath(fulfillmentOrderId, "/webhook"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
