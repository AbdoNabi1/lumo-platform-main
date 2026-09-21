import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ContactEmailProps {
  readonly value: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The address a checkout's receipt goes to — trimmed and lower-cased. Deliberately a local copy of
 * Identity's `Email` (`services/identity/src/domain/value-objects/email.ts`), not an import: a
 * cross-context import is forbidden (`pnpm arch`). Duplication is the correct trade until the
 * rule-of-three promotion to `@platform/domain`. Keep the normalisation identical — Identity looks
 * a guest customer up by this exact string.
 */
export class ContactEmail extends ValueObject<ContactEmailProps> {
  static create(value: string): Result<ContactEmail, ValidationError> {
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      return err(
        new ValidationError("Invalid email", [
          { field: "email", message: "must be a valid email" },
        ]),
      );
    }
    return ok(new ContactEmail({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
