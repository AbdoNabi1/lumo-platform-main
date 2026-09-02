import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

export type ConsentScopeValue = "marketing" | "analytics" | "data_sharing";

const ALLOWED: readonly ConsentScopeValue[] = ["marketing", "analytics", "data_sharing"];

interface ConsentScopeProps {
  readonly value: ConsentScopeValue;
}

/** A scope a customer can grant or revoke consent for (a closed Phase-1 set). */
export class ConsentScope extends ValueObject<ConsentScopeProps> {
  static create(value: string): Result<ConsentScope, ValidationError> {
    if (!ALLOWED.includes(value as ConsentScopeValue)) {
      return err(
        new ValidationError("Invalid consent scope", [
          { field: "scope", message: `must be one of: ${ALLOWED.join(", ")}` },
        ]),
      );
    }
    return ok(new ConsentScope({ value: value as ConsentScopeValue }));
  }

  get value(): ConsentScopeValue {
    return this.props.value;
  }
}
