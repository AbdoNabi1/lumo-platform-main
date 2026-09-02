import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CarrierProps {
  readonly value: string;
}

/** A provider-agnostic carrier code (e.g. "ups", "fedex") — never a provider-specific object. */
export class Carrier extends ValueObject<CarrierProps> {
  static create(value: string): Result<Carrier, ValidationError> {
    const guarded = Guard.againstEmpty(value, "carrier");
    return guarded.ok ? ok(new Carrier({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}

interface CarrierServiceProps {
  readonly value: string;
}

/** A provider-agnostic service-level code within a carrier (e.g. "ground", "express"). */
export class CarrierService extends ValueObject<CarrierServiceProps> {
  static create(value: string): Result<CarrierService, ValidationError> {
    const guarded = Guard.againstEmpty(value, "carrierService");
    return guarded.ok ? ok(new CarrierService({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}
