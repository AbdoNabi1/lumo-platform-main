import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CheckoutAddressProps {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface CheckoutAddressInput {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

/** A billing or shipping address snapshot — metadata only, no delivery/tax logic lives here. */
export class CheckoutAddress extends ValueObject<CheckoutAddressProps> {
  static create(input: CheckoutAddressInput): Result<CheckoutAddress, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (input.line1.trim().length === 0) issues.push({ field: "line1", message: "required" });
    if (input.city.trim().length === 0) issues.push({ field: "city", message: "required" });
    if (input.postalCode.trim().length === 0) {
      issues.push({ field: "postalCode", message: "required" });
    }
    if (input.country.trim().length === 0) issues.push({ field: "country", message: "required" });
    if (issues.length > 0) {
      return err(new ValidationError("Invalid address", issues));
    }
    return ok(
      new CheckoutAddress({
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
      }),
    );
  }

  get line1(): string {
    return this.props.line1;
  }

  get line2(): string | undefined {
    return this.props.line2;
  }

  get city(): string {
    return this.props.city;
  }

  get postalCode(): string {
    return this.props.postalCode;
  }

  get country(): string {
    return this.props.country;
  }
}
