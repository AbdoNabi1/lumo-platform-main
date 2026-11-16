import type { ShipmentDetailDto } from "./shipping";
import {
  getAdminApi,
  mutateAdminApi,
  postAdminApiForBytes,
  type ApiResult,
  type BytesResult,
  type MutationResult,
} from "./client";

export interface CarrierShipmentViewDto {
  readonly fulfillmentOrderId: string | null;
  readonly shipment:
    | (ShipmentDetailDto & {
        readonly carrierDeliveryId: string | null;
        readonly needsReview: boolean;
        readonly trackingEvents: readonly {
          description: string;
          location: string | null;
          occurredAt: string;
        }[];
      })
    | null;
  readonly carriers: readonly { readonly key: string; readonly displayName: string }[];
}

export interface ShipResultDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly shipmentId: string;
  readonly trackingNumber: string;
  readonly carrierKey: string;
}

export interface BulkShipFailureDto {
  readonly orderId: string;
  readonly code: string;
  readonly reason?: string;
  readonly orderNumber?: string;
  readonly attempted: boolean;
}

export interface BulkShipResultDto {
  readonly shipped: readonly ShipResultDto[];
  readonly failed: readonly BulkShipFailureDto[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isView(value: unknown): value is CarrierShipmentViewDto {
  return (
    isRecord(value) &&
    Array.isArray(value["carriers"]) &&
    (value["shipment"] === null || isRecord(value["shipment"]))
  );
}

function isShipResult(value: unknown): value is ShipResultDto {
  return (
    isRecord(value) &&
    typeof value["orderId"] === "string" &&
    typeof value["trackingNumber"] === "string"
  );
}

function isBulk(value: unknown): value is BulkShipResultDto {
  return (
    isRecord(value) &&
    Array.isArray(value["shipped"]) &&
    Array.isArray(value["failed"]) &&
    value["failed"].every(
      (f: unknown) =>
        isRecord(f) && typeof f["orderId"] === "string" && typeof f["code"] === "string",
    )
  );
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export function fetchOrderCarrierShipment(
  orderId: string,
): Promise<ApiResult<CarrierShipmentViewDto>> {
  return getAdminApi(`/api/v1/orders/${encodeURIComponent(orderId)}/carrier-shipment`, isView);
}

export function shipOrderWithCarrier(
  orderId: string,
  carrierKey: string,
  idempotencyKey: string,
): Promise<MutationResult<ShipResultDto>> {
  return mutateAdminApi(
    `/api/v1/orders/${encodeURIComponent(orderId)}/carrier-shipments`,
    { method: "POST", body: { carrierKey }, idempotencyKey, timeoutMs: 30_000 },
    isShipResult,
  );
}

export function shipOrdersWithCarrier(
  orderIds: readonly string[],
  carrierKey: string,
  idempotencyKey: string,
): Promise<MutationResult<BulkShipResultDto>> {
  return mutateAdminApi(
    "/api/v1/orders/carrier-shipments",
    { method: "POST", body: { orderIds, carrierKey }, idempotencyKey, timeoutMs: 75_000 },
    isBulk,
  );
}

export function cancelCarrierShipment(
  shipmentId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/shipments/${encodeURIComponent(shipmentId)}/cancel`,
    { method: "POST", idempotencyKey, timeoutMs: 30_000 },
    isUnknown,
  );
}

export function fetchAwbPdf(input: {
  orderIds: readonly string[];
  format?: "A4" | "A6";
  lang?: "ar" | "en";
}): Promise<BytesResult> {
  return postAdminApiForBytes(
    "/api/v1/shipments/awb",
    {
      orderIds: input.orderIds,
      ...(input.format === undefined ? {} : { format: input.format }),
      ...(input.lang === undefined ? {} : { lang: input.lang }),
    },
    30_000,
  );
}
