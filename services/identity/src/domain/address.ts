import { Entity, type UniqueEntityId, ValidationError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface AddressProps {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

/** A postal address owned by a customer (identity by id; a customer may hold several). */
export class Address extends Entity<AddressProps> {
  static create(
    id: UniqueEntityId,
    line1: string,
    city: string,
    postalCode: string,
    country: string,
  ): Result<Address, ValidationError> {
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
    return ok(new Address({ line1, city, postalCode, country }, id));
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
