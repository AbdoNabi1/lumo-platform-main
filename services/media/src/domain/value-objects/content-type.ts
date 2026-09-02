import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ContentTypeProps {
  readonly value: string;
}

const CONTENT_TYPE_PATTERN = /^[a-z]+\/[a-z0-9.+-]+$/;

/** A MIME content type, e.g. `image/png`. */
export class ContentType extends ValueObject<ContentTypeProps> {
  static create(value: string): Result<ContentType, ValidationError> {
    if (!CONTENT_TYPE_PATTERN.test(value)) {
      return err(
        new ValidationError(`Invalid content type "${value}"`, [
          { field: "contentType", message: "must be a MIME type like image/png" },
        ]),
      );
    }
    return ok(new ContentType({ value }));
  }

  get value(): string {
    return this.props.value;
  }
}
