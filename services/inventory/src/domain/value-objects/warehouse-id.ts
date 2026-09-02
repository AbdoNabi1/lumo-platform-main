import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface WarehouseIdProps {
  readonly value: string;
}

/** Identifies a warehouse (a non-empty string). */
export class WarehouseId extends ValueObject<WarehouseIdProps> {
  static create(value: string): Result<WarehouseId, ValidationError> {
    const guarded = Guard.againstEmpty(value, "warehouseId");
    return guarded.ok ? ok(new WarehouseId({ value: value.trim() })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
