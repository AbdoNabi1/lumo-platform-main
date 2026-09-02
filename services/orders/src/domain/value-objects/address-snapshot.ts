import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface AddressSnapshotProps {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

/** An immutable copy of the shipping address captured at placement (snapshot, not a live ref). */
export class AddressSnapshot extends ValueObject<AddressSnapshotProps> {
  static create(
    line1: string,
    city: string,
    postalCode: string,
    country: string,
  ): Result<AddressSnapshot, ValidationError> {
    const fields: readonly [string, string][] = [
      ["line1", line1],
      ["city", city],
      ["postalCode", postalCode],
      ["country", country],
    ];
    const issues = fields
      .filter(([, value]) => value.trim().length === 0)
      .map(([field]) => ({ field, message: "must not be empty" }));
    if (issues.length > 0) {
      return err(new ValidationError("Invalid address", issues));
    }
    return ok(new AddressSnapshot({ line1, city, postalCode, country }));
  }

  get line1(): string {
    return this.props.line1;
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
