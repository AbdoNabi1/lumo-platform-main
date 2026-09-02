import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface ShipmentDetailDto {
  readonly id: string;
  readonly fulfillmentRef: string;
  readonly status: string;
  readonly carrier: string | null;
  readonly carrierService: string | null;
  readonly trackingNumber: string | null;
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
}

function isShipmentDetailDto(value: unknown): value is ShipmentDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export type FetchShipmentResult =
  | { readonly outcome: "ok"; readonly shipment: ShipmentDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches the shipment opened for a fulfillment order, if any (Order Detail screen's Shipping panel). */
export async function fetchShipmentByFulfillment(
  fulfillmentOrderId: string,
): Promise<FetchShipmentResult> {
  const result = await getAdminApi(
    `/api/v1/fulfillments/${encodeURIComponent(fulfillmentOrderId)}/shipment`,
    isShipmentDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", shipment: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

/**
 * T5.4 — the 7 shipping write routes below (`shipping-routes.ts`). None of their handlers map the
 * response through a DTO (each is a plain `return admin.shipping.<x>(...)` — only
 * `getByFulfillment` above calls `toShipmentDetailDto`), same non-DTO write discipline as
 * `returns.ts`/`fulfillment.ts` — `isUnknown` only checks the call succeeded. Callers
 * `revalidatePath` the shipment detail page afterwards, which re-fetches the real, DTO-mapped state
 * via `fetchShipmentByFulfillment`.
 */
function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function shipmentPath(shipmentId: string, suffix: string): string {
  return `/api/v1/shipments/${encodeURIComponent(shipmentId)}${suffix}`;
}

export interface CreateShipmentPackageInput {
  readonly reference: string;
  readonly itemRefs: readonly string[];
  readonly weightGrams: number;
}

export interface CreateShipmentInput {
  readonly fulfillmentRef: string;
  readonly packages: readonly CreateShipmentPackageInput[];
}

/**
 * Opens a shipment for a fulfillment order's packages (`POST /shipments`, `idempotent: true`,
 * `shipping:create`). The created shipment is keyed by `fulfillmentRef`, not returned here — the
 * caller re-fetches it via `fetchShipmentByFulfillment`, same as every other write below.
 */
export function createShipment(
  input: CreateShipmentInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/shipments",
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/**
 * Advances a shipment to any status its current status's transition table allows (`POST
 * /shipments/:shipmentId/transitions`, `idempotent: true`, `shipping:advance`) — the fallback for
 * the transition targets with no dedicated action
 * (`lib/shipping-lifecycle.ts`'s `advanceableShipmentStatusesFrom`).
 */
export function advanceShipment(
  shipmentId: string,
  toStatus: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/transitions"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

/** Requests a label from the carrier via the CarrierProviderPort (`POST /shipments/:shipmentId/label`, `idempotent: true`, `shipping:create_label`). */
export function createShipmentLabel(
  shipmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/label"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** Voids the shipment's label at the carrier (`POST /shipments/:shipmentId/label-void`, `idempotent: true`, `shipping:void_label`). */
export function voidShipmentLabel(
  shipmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/label-void"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

export interface UpdateShipmentTrackingInput {
  readonly description: string;
  readonly location?: string;
}

/**
 * Appends a carrier tracking scan to the shipment's history (`POST
 * /shipments/:shipmentId/tracking`, `idempotent: false`, `shipping:update_tracking`). Same
 * `Idempotency-Key` note as `createShipmentLabel`'s route neighbors: `mutateAdminApi` always sends
 * the header when a key is passed, regardless of the route's own `idempotent` flag; the caller
 * still mints exactly one key per submit.
 */
export function updateShipmentTracking(
  shipmentId: string,
  input: UpdateShipmentTrackingInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/tracking"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/**
 * Retries a shipment from a recoverable state (`POST /shipments/:shipmentId/retry`,
 * `idempotent: true`, `shipping:retry`). Only meaningful from `rejected`/`delivery_failed`/
 * `exception` — the 3 recoverable states (`lib/shipping-lifecycle.ts`'s `canRetryFrom`); surfaced
 * as its own dedicated button rather than folded into the generic advance dropdown, per the brief.
 */
export function retryShipment(
  shipmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/retry"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

export interface RecordShipmentWebhookInput {
  readonly carrier: string;
  readonly eventId: string;
  readonly kind: string;
}

/** Records a carrier webhook (replay-safe) (`POST /shipments/:shipmentId/webhook`, `idempotent: false`, `shipping:record_webhook`). */
export function recordShipmentWebhook(
  shipmentId: string,
  input: RecordShipmentWebhookInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    shipmentPath(shipmentId, "/webhook"),
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
