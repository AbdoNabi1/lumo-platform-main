import { DomainError } from "@platform/utils";

export type CarrierErrorStatus = 409 | 422 | 503;

/**
 * A carrier-path failure with its own specific code (Ruling 19): `code` is the code itself
 * (`ADDRESS_NOT_SHIPPABLE`, `CARRIER_RESULT_UNKNOWN`, …) so the envelope's `body.code` carries it,
 * and `message` is `"<CODE>: <text>"` (spec §7's prefix rule). `httpStatus` is the transport status
 * the presenter answers with; `reason` is an optional allow-listed detail (never carrier text).
 */
export class CarrierError extends DomainError {
  readonly retryable: boolean;
  readonly httpStatus: CarrierErrorStatus;
  readonly reason?: string;

  constructor(code: string, text: string, httpStatus: CarrierErrorStatus, reason?: string) {
    super(`${code}: ${text}`, { code });
    this.httpStatus = httpStatus;
    this.retryable = httpStatus === 503;
    this.reason = reason;
  }
}
