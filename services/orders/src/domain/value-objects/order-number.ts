import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface OrderNumberProps {
  readonly value: string;
}

/** A human-facing order number (non-empty; assigned at placement). */
export class OrderNumber extends ValueObject<OrderNumberProps> {
  static create(value: string): Result<OrderNumber, ValidationError> {
    const guarded = Guard.againstEmpty(value, "orderNumber");
    return guarded.ok ? ok(new OrderNumber({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
