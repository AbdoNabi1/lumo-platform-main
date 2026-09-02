import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

interface CouponCodeProps {
  readonly value: string;
}

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** A redeemable coupon code — normalized upper-case, validated format. */
export class CouponCode extends ValueObject<CouponCodeProps> {
  static create(value: string): Result<CouponCode, ValidationError> {
    const guarded = Guard.againstEmpty(value, "code");
    if (!guarded.ok) return err(guarded.error);
    const normalized = value.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) {
      return err(
        new ValidationError("Invalid coupon code", [
          { field: "code", message: "must be 3-32 characters of A-Z, 0-9, _ or -" },
        ]),
      );
    }
    return ok(new CouponCode({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }
}
