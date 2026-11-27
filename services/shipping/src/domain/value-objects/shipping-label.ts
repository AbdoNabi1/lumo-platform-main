import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ShippingLabelProps {
  readonly labelId: string;
  readonly trackingNumber: string;
  readonly carrierDeliveryId?: string;
}

/**
 * A carrier-issued label reference — id + tracking number, plus the carrier's own delivery id for
 * carrier-managed shipments (e.g. Bosta's `_id`). No label bytes, no rate, no PII (G-27).
 */
export class ShippingLabel extends ValueObject<ShippingLabelProps> {
  static create(
    labelId: string,
    trackingNumber: string,
    carrierDeliveryId?: string,
  ): Result<ShippingLabel, ValidationError> {
    const guardedLabelId = Guard.againstEmpty(labelId, "labelId");
    if (!guardedLabelId.ok) return err(guardedLabelId.error);
    const guardedTrackingNumber = Guard.againstEmpty(trackingNumber, "trackingNumber");
    if (!guardedTrackingNumber.ok) return err(guardedTrackingNumber.error);
    if (carrierDeliveryId !== undefined) {
      const guardedDeliveryId = Guard.againstEmpty(carrierDeliveryId, "carrierDeliveryId");
      if (!guardedDeliveryId.ok) return err(guardedDeliveryId.error);
      return ok(new ShippingLabel({ labelId, trackingNumber, carrierDeliveryId }));
    }
    return ok(new ShippingLabel({ labelId, trackingNumber }));
  }

  get labelId(): string {
    return this.props.labelId;
  }

  get trackingNumber(): string {
    return this.props.trackingNumber;
  }

  /** The carrier's own delivery id; absent for legacy labels and for rows written before it existed. */
  get carrierDeliveryId(): string | undefined {
    return this.props.carrierDeliveryId;
  }
}
