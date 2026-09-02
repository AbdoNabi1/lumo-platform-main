import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface DeliveryEstimateProps {
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

/** A carrier-provided delivery window — never a promise the domain enforces, purely informational. */
export class DeliveryEstimate extends ValueObject<DeliveryEstimateProps> {
  static create(windowStart: Date, windowEnd: Date): Result<DeliveryEstimate, ValidationError> {
    if (windowEnd.getTime() < windowStart.getTime()) {
      return err(
        new ValidationError("Invalid delivery estimate", [
          { field: "windowEnd", message: "must not be before windowStart" },
        ]),
      );
    }
    return ok(new DeliveryEstimate({ windowStart, windowEnd }));
  }

  get windowStart(): Date {
    return this.props.windowStart;
  }

  get windowEnd(): Date {
    return this.props.windowEnd;
  }
}
