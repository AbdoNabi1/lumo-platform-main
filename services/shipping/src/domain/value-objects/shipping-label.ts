import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ShippingLabelProps {
  readonly labelId: string;
  readonly trackingNumber: string;
}

/** A carrier-issued label reference — id + tracking number only. No label bytes, no rate, no PII (G-27). */
export class ShippingLabel extends ValueObject<ShippingLabelProps> {
  static create(labelId: string, trackingNumber: string): Result<ShippingLabel, ValidationError> {
    const guardedLabelId = Guard.againstEmpty(labelId, "labelId");
    if (!guardedLabelId.ok) return err(guardedLabelId.error);
    const guardedTrackingNumber = Guard.againstEmpty(trackingNumber, "trackingNumber");
    if (!guardedTrackingNumber.ok) return err(guardedTrackingNumber.error);
    return ok(new ShippingLabel({ labelId, trackingNumber }));
  }

  get labelId(): string {
    return this.props.labelId;
  }

  get trackingNumber(): string {
    return this.props.trackingNumber;
  }
}
