import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface SlugProps {
  readonly value: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** URL slug — lower kebab-case. */
export class Slug extends ValueObject<SlugProps> {
  static create(value: string): Result<Slug, ValidationError> {
    if (!SLUG_PATTERN.test(value)) {
      return err(
        new ValidationError(`Invalid slug "${value}"`, [
          { field: "slug", message: "must be lower kebab-case (a-z, 0-9, hyphen)" },
        ]),
      );
    }
    return ok(new Slug({ value }));
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
