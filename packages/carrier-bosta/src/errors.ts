export type BostaFailureKind = "rejected" | "unavailable" | "credentials_rejected";
export type BostaRejectionCode =
  | "ADDRESS_NOT_SHIPPABLE"
  | "PHONE_NOT_SHIPPABLE"
  | "COD_ABOVE_CARRIER_LIMIT"
  | "COD_INVALID"
  | "CURRENCY_NOT_SUPPORTED"
  | "OPEN_PACKAGE_NEEDS_IMAGES"
  | "CARRIER_REJECTED"
  | "CARRIER_CANCEL_REFUSED";

export class BostaApiError extends Error {
  readonly carrierFailure: BostaFailureKind;
  readonly code?: BostaRejectionCode;
  readonly reason?: string;
  readonly status: number;
  readonly timedOut: boolean;

  constructor(init: {
    carrierFailure: BostaFailureKind;
    status: number;
    message: string;
    code?: BostaRejectionCode;
    reason?: string;
    timedOut?: boolean;
  }) {
    super(init.message);
    this.name = "BostaApiError";
    this.carrierFailure = init.carrierFailure;
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.timedOut = init.timedOut ?? false;
  }
}
