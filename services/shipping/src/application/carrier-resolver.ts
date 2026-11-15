import type { CarrierProvider } from "./carrier-provider";

/** Ruling 30: a new shipment needs the carrier enabled; an existing one (cancel, print) only configured. */
export type CarrierResolutionPurpose = "new_shipment" | "existing_shipment";

export type CarrierResolutionCode =
  "CARRIER_UNKNOWN" | "CARRIER_NOT_ENABLED" | "CARRIER_NOT_CONFIGURED" | "CARRIER_NOT_AVAILABLE";

const MESSAGES: Readonly<Record<CarrierResolutionCode, string>> = {
  CARRIER_UNKNOWN: "no such carrier on this platform",
  CARRIER_NOT_ENABLED: "the merchant has not enabled this carrier",
  CARRIER_NOT_CONFIGURED: "the merchant has not configured this carrier",
  CARRIER_NOT_AVAILABLE: "carriers are not available on this platform",
};

/** Why a carrier could not be resolved. The message is `"<CODE>: <text>"` and names no key or secret. */
export class CarrierResolutionError extends Error {
  readonly code: CarrierResolutionCode;

  constructor(code: CarrierResolutionCode) {
    super(`${code}: ${MESSAGES[code]}`);
    this.name = "CarrierResolutionError";
    this.code = code;
  }
}

/** ADR-0014: a process-wide singleton resolving one tenant's carrier per call. */
export interface CarrierResolver {
  resolve(
    tenantId: string,
    carrierKey: string,
    purpose: CarrierResolutionPurpose,
  ): Promise<CarrierProvider>;
}
