import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface RecipientProps {
  readonly customerRef: string;
}

/** Who a notification is for — a bare reference only, never a contact address/PII (ADR-0006). The provider resolves the real address at send time. */
export class Recipient extends ValueObject<RecipientProps> {
  static create(customerRef: string): Result<Recipient, ValidationError> {
    const guarded = Guard.againstEmpty(customerRef, "customerRef");
    return guarded.ok ? ok(new Recipient({ customerRef })) : err(guarded.error);
  }

  get customerRef(): string {
    return this.props.customerRef;
  }
}
