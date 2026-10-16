import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface AddressSnapshotProps {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  /** May be empty. */
  readonly postalCode: string;
  readonly country: string;
  readonly recipientName?: string;
  readonly phone?: string;
  /** Plan 3C: ISO 3166-2 (`EG-C`), for countries with province data. */
  readonly province?: string;
}

/** Plan 3A: who receives the order, and the second address line. Plan 3C: the province. All optional. */
export interface AddressSnapshotExtra {
  readonly recipientName?: string;
  readonly phone?: string;
  readonly line2?: string;
  readonly province?: string;
}

/** An immutable copy of the shipping address captured at placement (snapshot, not a live ref). */
export class AddressSnapshot extends ValueObject<AddressSnapshotProps> {
  static create(
    line1: string,
    city: string,
    postalCode: string,
    country: string,
    extra?: AddressSnapshotExtra,
  ): Result<AddressSnapshot, ValidationError> {
    const fields: readonly [string, string][] = [
      ["line1", line1],
      ["city", city],
      ["country", country],
    ];
    const issues = fields
      .filter(([, value]) => value.trim().length === 0)
      .map(([field]) => ({ field, message: "must not be empty" }));
    if (issues.length > 0) {
      return err(new ValidationError("Invalid address", issues));
    }
    return ok(
      new AddressSnapshot({
        line1,
        line2: extra?.line2,
        city,
        postalCode,
        country,
        recipientName: extra?.recipientName,
        phone: extra?.phone,
        ...(extra?.province === undefined ? {} : { province: extra.province }),
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

  get recipientName(): string | undefined {
    return this.props.recipientName;
  }

  get phone(): string | undefined {
    return this.props.phone;
  }

  get province(): string | undefined {
    return this.props.province;
  }
}
