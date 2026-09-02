import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type ReturnDispositionValue = "restock" | "discard" | "refurbish" | "return_to_vendor";

const VALID_DISPOSITIONS: readonly ReturnDispositionValue[] = [
  "restock",
  "discard",
  "refurbish",
  "return_to_vendor",
];

interface ReturnDispositionProps {
  readonly value: ReturnDispositionValue;
}

/** What happens to a returned item after inspection — decided by the inspector, never inferred. */
export class ReturnDisposition extends ValueObject<ReturnDispositionProps> {
  static create(value: string): Result<ReturnDisposition, ValidationError> {
    if (!VALID_DISPOSITIONS.includes(value as ReturnDispositionValue)) {
      return err(
        new ValidationError("Invalid return disposition", [
          { field: "disposition", message: `must be one of ${VALID_DISPOSITIONS.join(", ")}` },
        ]),
      );
    }
    return ok(new ReturnDisposition({ value: value as ReturnDispositionValue }));
  }

  get value(): ReturnDispositionValue {
    return this.props.value;
  }
}
