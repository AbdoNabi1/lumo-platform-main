import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface EmailProps {
  readonly value: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A customer's email address — trimmed and lower-cased; the natural key for a customer. */
export class Email extends ValueObject<EmailProps> {
  static create(value: string): Result<Email, ValidationError> {
    const normalized = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      return err(
        new ValidationError("Invalid email", [
          { field: "email", message: "must be a valid email" },
        ]),
      );
    }
    return ok(new Email({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
