import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

interface LocaleCodeProps {
  readonly value: string;
}

/** A BCP-47-style locale code (`en`, `en-US`, ...). */
export class LocaleCode extends ValueObject<LocaleCodeProps> {
  static create(value: string): Result<LocaleCode, ValidationError> {
    const guarded = Guard.againstEmpty(value, "code");
    if (!guarded.ok) return err(guarded.error);
    if (!LOCALE_PATTERN.test(value)) {
      return err(
        new ValidationError("Invalid locale code", [
          { field: "code", message: "must match xx or xx-XX (e.g. en, en-US)" },
        ]),
      );
    }
    return ok(new LocaleCode({ value }));
  }

  get value(): string {
    return this.props.value;
  }
}
