import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ReturnReasonProps {
  readonly code: string;
  readonly note?: string;
}

/** Why a customer is returning an item — a merchant-defined reason code plus an optional free-text note. */
export class ReturnReason extends ValueObject<ReturnReasonProps> {
  static create(code: string, note?: string): Result<ReturnReason, ValidationError> {
    const guarded = Guard.againstEmpty(code, "reasonCode");
    return guarded.ok ? ok(new ReturnReason({ code, note })) : err(guarded.error);
  }

  get code(): string {
    return this.props.code;
  }

  get note(): string | undefined {
    return this.props.note;
  }
}
