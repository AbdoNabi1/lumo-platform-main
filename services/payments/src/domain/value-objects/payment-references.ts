import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface PspReferenceProps {
  readonly value: string;
}

/** The PSP's own reference for this intent (e.g. a provider intent id) — never a card/PII value. */
export class PspReference extends ValueObject<PspReferenceProps> {
  static create(value: string): Result<PspReference, ValidationError> {
    const guarded = Guard.againstEmpty(value, "pspReference");
    return guarded.ok ? ok(new PspReference({ value })) : err(guarded.error);
  }

  get value(): string {
    return this.props.value;
  }
}

interface PaymentMethodProps {
  readonly token: string;
  readonly brand?: string;
}

/** A tokenized payment method (e.g. "visa" + PSP token) — no card data ever touches this VO (G-27). */
export class PaymentMethod extends ValueObject<PaymentMethodProps> {
  static create(token: string, brand?: string): Result<PaymentMethod, ValidationError> {
    const guarded = Guard.againstEmpty(token, "paymentMethodToken");
    return guarded.ok ? ok(new PaymentMethod({ token, brand })) : err(guarded.error);
  }

  get token(): string {
    return this.props.token;
  }

  get brand(): string | undefined {
    return this.props.brand;
  }
}
