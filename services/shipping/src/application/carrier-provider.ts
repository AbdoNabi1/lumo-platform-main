/**
 * The port a carrier package satisfies STRUCTURALLY (Ruling 20): `packages/carrier-*` never imports
 * `@platform/shipping`, it declares the same shapes locally, and the runtime's registration is the
 * compile-time check that the two agree. Nothing here names a carrier.
 */

export interface CarrierParcelRequest {
  readonly recipient: { readonly name: string; readonly phone: string };
  readonly address: {
    readonly line1: string;
    readonly line2?: string;
    readonly city: string;
    readonly province?: string;
    readonly country: string;
  };
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly itemsCount: number;
  readonly description: string;
  readonly packageImages: readonly string[];
}

export interface CarrierDeliveryRequest extends CarrierParcelRequest {
  readonly reference: string;
}

export interface CarrierDelivery {
  readonly deliveryId: string;
  readonly trackingNumber: string;
}

export type CarrierRejectionCode =
  | "ADDRESS_NOT_SHIPPABLE"
  | "PHONE_NOT_SHIPPABLE"
  | "COD_ABOVE_CARRIER_LIMIT"
  | "COD_INVALID"
  | "CURRENCY_NOT_SUPPORTED"
  | "OPEN_PACKAGE_NEEDS_IMAGES"
  | "CARRIER_REJECTED"
  | "CARRIER_CANCEL_REFUSED";

const REJECTION_CODES: ReadonlySet<string> = new Set<CarrierRejectionCode>([
  "ADDRESS_NOT_SHIPPABLE",
  "PHONE_NOT_SHIPPABLE",
  "COD_ABOVE_CARRIER_LIMIT",
  "COD_INVALID",
  "CURRENCY_NOT_SUPPORTED",
  "OPEN_PACKAGE_NEEDS_IMAGES",
  "CARRIER_REJECTED",
  "CARRIER_CANCEL_REFUSED",
]);

/** A refusal found before any carrier call. `code` is the literal union (preflight F3 / P9). */
export interface CarrierProblem {
  readonly code: CarrierRejectionCode;
  readonly reason?: string;
}

export type CarrierStatusTarget =
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | "returned"
  | "cancelled"
  | "exception";

export interface CarrierDeliveryStatus {
  readonly trackingNumber: string;
  readonly stateCode: number;
  readonly stateLabel: string;
  readonly target: CarrierStatusTarget | null;
}

export interface AwbOptions {
  readonly format?: "A4" | "A6";
  readonly lang?: "ar" | "en";
}

/**
 * One merchant's carrier, built for ONE resolution from that merchant's opened credentials
 * (`TenantCarrierResolver`) and never retained.
 */
export interface CarrierProvider {
  readonly key: string;
  prepare(request: CarrierParcelRequest): Promise<CarrierProblem | null>;
  createDelivery(request: CarrierDeliveryRequest): Promise<CarrierDelivery>;
  findDeliveriesByReference(reference: string): Promise<readonly CarrierDelivery[]>;
  cancelDelivery(trackingNumber: string): Promise<"cancelled" | "not_found">;
  printAwbs(trackingNumbers: readonly string[], options: AwbOptions): Promise<Uint8Array>;
  getDelivery(trackingNumber: string): Promise<CarrierDeliveryStatus>;
  verifyCredentials(): Promise<void>;
}

export type CarrierFailureKind = "rejected" | "unavailable" | "credentials_rejected";

const FAILURE_KINDS: ReadonlySet<string> = new Set<CarrierFailureKind>([
  "rejected",
  "unavailable",
  "credentials_rejected",
]);

/** What a carrier package's thrown error carries, read by its discriminant property. */
export interface CarrierFailure {
  readonly carrierFailure: CarrierFailureKind;
  readonly code?: CarrierRejectionCode;
  readonly reason?: string;
  readonly timedOut?: boolean;
}

/**
 * Reads the discriminant; null for anything else (never `instanceof`, Ruling 20). Only the known
 * fields are copied, and only when they have the declared type, so nothing else a carrier error
 * carries (a response body, a header) travels further.
 */
export function carrierFailureOf(error: unknown): CarrierFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Record<string, unknown>;
  const kind = candidate["carrierFailure"];
  if (typeof kind !== "string" || !FAILURE_KINDS.has(kind)) return null;

  const code = candidate["code"];
  const reason = candidate["reason"];
  const timedOut = candidate["timedOut"];
  return {
    carrierFailure: kind as CarrierFailureKind,
    ...(typeof code === "string" && REJECTION_CODES.has(code)
      ? { code: code as CarrierRejectionCode }
      : {}),
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof timedOut === "boolean" ? { timedOut } : {}),
  };
}
