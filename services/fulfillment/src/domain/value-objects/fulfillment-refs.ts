import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CarrierReferenceProps {
  readonly carrier: string;
  readonly carrierShipmentId: string;
}

/**
 * Identifies a shipment at a specific carrier. Carrier-agnostic by construction — multiple carriers
 * are a composition/config choice (`ShippingProviderPort` implementations), never domain logic.
 */
export class CarrierReference extends ValueObject<CarrierReferenceProps> {
  static create(
    carrier: string,
    carrierShipmentId: string,
  ): Result<CarrierReference, ValidationError> {
    const guardedCarrier = Guard.againstEmpty(carrier, "carrier");
    if (!guardedCarrier.ok) return err(guardedCarrier.error);
    const guardedShipmentId = Guard.againstEmpty(carrierShipmentId, "carrierShipmentId");
    if (!guardedShipmentId.ok) return err(guardedShipmentId.error);
    return ok(new CarrierReference({ carrier, carrierShipmentId }));
  }

  get carrier(): string {
    return this.props.carrier;
  }

  get carrierShipmentId(): string {
    return this.props.carrierShipmentId;
  }
}

interface TrackingNumberProps {
  readonly value: string;
}

/** A carrier-issued tracking number — an opaque string, never parsed against a carrier-specific format (carrier-agnostic). */
export class TrackingNumber extends ValueObject<TrackingNumberProps> {
  static create(value: string): Result<TrackingNumber, ValidationError> {
    const guarded = Guard.againstEmpty(value, "trackingNumber");
    return guarded.ok ? ok(new TrackingNumber({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}
