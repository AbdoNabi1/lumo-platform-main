import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

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
