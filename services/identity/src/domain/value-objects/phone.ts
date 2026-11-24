import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

export class Phone extends ValueObject<{ readonly value: string }> {
  static create(raw: string): Result<Phone, ValidationError> {
    const value = raw.trim().replace(/[\s().-]/gu, "");
    if (!/^\+?[0-9]{7,15}$/.test(value))
      return err(
        new ValidationError("Invalid phone", [
          { field: "phone", message: "must be 7 to 15 digits, optionally starting with +" },
        ]),
      );
    return ok(new Phone({ value }));
  }
  get value(): string {
    return this.props.value;
  }
}
