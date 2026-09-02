import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

interface CanonicalIdProps {
  readonly value: string;
}

const SEGMENT_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A governed dotted id (e.g. `finance.gross_margin`) — the single namespacing scheme every
 * metric, dimension, and read model in the semantic layer is addressed by. Each dot-separated
 * segment is lowercase `snake_case`; there is no other identifier scheme anywhere in Analytics.
 */
export class CanonicalId extends ValueObject<CanonicalIdProps> {
  static define(value: string): Result<CanonicalId, ValidationError> {
    const segments = value.split(".");
    const invalid = segments.some((segment) => !SEGMENT_PATTERN.test(segment));
    if (value.trim().length === 0 || invalid) {
      return err(
        new ValidationError("Invalid canonical id", [
          {
            field: "value",
            message: "must be one or more dot-separated lower_snake_case segments",
          },
        ]),
      );
    }
    return ok(new CanonicalId({ value }));
  }

  get value(): string {
    return this.props.value;
  }

  /** The leading segment — conventionally the owning context (e.g. `finance`). */
  get namespace(): string {
    // `String.split` always returns at least one element, so this index is never actually
    // `undefined` — the fallback exists only to satisfy that without a non-null assertion.
    return this.props.value.split(".")[0] ?? this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
