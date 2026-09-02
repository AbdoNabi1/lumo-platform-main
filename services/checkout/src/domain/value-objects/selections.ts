import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface ShippingSelectionProps {
  readonly method: string;
  readonly rateAmountMinor: number;
  readonly currency: string;
}

/** The chosen shipping method + its quoted rate snapshot (requested from Shipping via `ShippingCalculationPort`, never computed here). */
export class ShippingSelection extends ValueObject<ShippingSelectionProps> {
  static create(
    method: string,
    rateAmountMinor: number,
    currency: string,
  ): Result<ShippingSelection, ValidationError> {
    if (method.trim().length === 0) {
      return err(
        new ValidationError("Invalid shipping selection", [
          { field: "method", message: "must not be empty" },
        ]),
      );
    }
    if (!Number.isInteger(rateAmountMinor) || rateAmountMinor < 0) {
      return err(
        new ValidationError("Invalid shipping selection", [
          { field: "rateAmountMinor", message: "must be a non-negative integer" },
        ]),
      );
    }
    return ok(new ShippingSelection({ method, rateAmountMinor, currency }));
  }

  get method(): string {
    return this.props.method;
  }

  get rateAmountMinor(): number {
    return this.props.rateAmountMinor;
  }

  get currency(): string {
    return this.props.currency;
  }
}

interface PaymentSelectionProps {
  readonly paymentMethodRef: string;
  readonly provider: string;
}

/** The chosen payment method reference — a bare reference into Payments, never a captured instrument. */
export class PaymentSelection extends ValueObject<PaymentSelectionProps> {
  static create(
    paymentMethodRef: string,
    provider: string,
  ): Result<PaymentSelection, ValidationError> {
    if (paymentMethodRef.trim().length === 0) {
      return err(
        new ValidationError("Invalid payment selection", [
          { field: "paymentMethodRef", message: "must not be empty" },
        ]),
      );
    }
    if (provider.trim().length === 0) {
      return err(
        new ValidationError("Invalid payment selection", [
          { field: "provider", message: "must not be empty" },
        ]),
      );
    }
    return ok(new PaymentSelection({ paymentMethodRef, provider }));
  }

  get paymentMethodRef(): string {
    return this.props.paymentMethodRef;
  }

  get provider(): string {
    return this.props.provider;
  }
}
