import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CheckoutAddressProps {
  readonly name?: string;
  readonly phone?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  /** May be empty: many countries the store ships to have no postal codes. */
  readonly postalCode: string;
  readonly country: string;
}

export interface CheckoutAddressInput {
  /** Plan 3A: who receives the order. */
  readonly name?: string;
  /** Plan 3A: how the courier reaches them. */
  readonly phone?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

const NAME_MAX_LENGTH = 120;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** Arabic-Indic (U+0660–0669) and Persian (U+06F0–06F9) digits to ASCII. */
function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Digits (any script) with an optional leading `+`; spaces, dashes and brackets are dropped. */
function normalizePhone(raw: string): string {
  return toAsciiDigits(raw).replace(/[\s\-()]/g, "");
}

/** A billing or shipping address snapshot — metadata only, no delivery/tax logic lives here. */
export class CheckoutAddress extends ValueObject<CheckoutAddressProps> {
  static create(input: CheckoutAddressInput): Result<CheckoutAddress, ValidationError> {
    const issues: { readonly field: string; readonly message: string }[] = [];
    if (input.line1.trim().length === 0) issues.push({ field: "line1", message: "required" });
    if (input.city.trim().length === 0) issues.push({ field: "city", message: "required" });
    if (input.country.trim().length === 0) issues.push({ field: "country", message: "required" });

    const name = input.name?.trim();
    if (name !== undefined && (name.length === 0 || name.length > NAME_MAX_LENGTH)) {
      issues.push({ field: "name", message: `must be 1-${NAME_MAX_LENGTH} characters` });
    }

    const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
    if (phone !== undefined && !PHONE_PATTERN.test(phone)) {
      issues.push({ field: "phone", message: "must be 7-15 digits, optionally starting with +" });
    }

    if (issues.length > 0) {
      return err(new ValidationError("Invalid address", issues));
    }
    return ok(
      new CheckoutAddress({
        name,
        phone,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        postalCode: input.postalCode.trim(),
        country: input.country,
      }),
    );
  }

  get name(): string | undefined {
    return this.props.name;
  }

  get phone(): string | undefined {
    return this.props.phone;
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
