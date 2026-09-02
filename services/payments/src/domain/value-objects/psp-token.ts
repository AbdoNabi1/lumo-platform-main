import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface PspTokenProps {
  readonly value: string;
}

/**
 * An opaque payment-method token issued by the PSP (a non-empty string). The platform never stores
 * raw card data — only this token (the vault lives at the PSP).
 */
export class PspToken extends ValueObject<PspTokenProps> {
  static create(value: string): Result<PspToken, ValidationError> {
    const guarded = Guard.againstEmpty(value, "pspToken");
    return guarded.ok ? ok(new PspToken({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}
