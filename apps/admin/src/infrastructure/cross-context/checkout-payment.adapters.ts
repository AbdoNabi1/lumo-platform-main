import type { PaymentInitiationPort, PaymentMethodPort } from "@platform/checkout";
import type { MerchantPaymentSettingsDto, PaymentController } from "@platform/payments";
import { BusinessRuleError, ValidationError } from "@platform/utils";

interface CreateIntentBody {
  readonly paymentIntentId: string;
  readonly status: string;
  readonly provider: string;
  readonly clientHandle?: string;
}

/**
 * Real `PaymentMethodPort` (WP-13): the methods a merchant offers, read from Payments' own merchant
 * settings. A method is OFFERED only when the merchant enabled it AND the platform can really back
 * it — so a shopper is never shown (or allowed to select) a method that would only be refused, or
 * worse served by a stub, when they pay.
 *
 * Stateless per tenant: `enabledMethods` carries `tenantId` per call (ADR-0014).
 */
export class CheckoutPaymentMethodsAdapter implements PaymentMethodPort {
  private readonly payments: Pick<PaymentController, "getMerchantPaymentSettings">;

  constructor(payments: Pick<PaymentController, "getMerchantPaymentSettings">) {
    this.payments = payments;
  }

  async enabledMethods(tenantId: string): Promise<readonly string[]> {
    const response = await this.payments.getMerchantPaymentSettings({ tenantId });
    if (response.status !== 200) {
      throw new Error(
        `CheckoutPaymentMethodsAdapter: settings lookup failed (status ${response.status})`,
      );
    }
    const settings = response.body as MerchantPaymentSettingsDto;
    return settings.enabledMethods.filter((method) => settings.methods[method]?.available === true);
  }
}

/**
 * Real `PaymentInitiationPort` (WP-13) over Payments' `createIntentLifecycle`. `provider` is passed
 * through exactly as the checkout session recorded it — this adapter has no default, no fallback and
 * no preference; a method Payments will not serve for this merchant is refused, not replaced.
 *
 * A 4xx from Payments (method not enabled/unavailable, invalid amount) becomes a 4xx here — the
 * shopper can change their selection — and anything else is a plain `Error` (a 5xx).
 */
export class CheckoutPaymentInitiationAdapter implements PaymentInitiationPort {
  private readonly payments: Pick<PaymentController, "createIntentLifecycle">;

  constructor(payments: Pick<PaymentController, "createIntentLifecycle">) {
    this.payments = payments;
  }

  async initiate(input: Parameters<PaymentInitiationPort["initiate"]>[0]) {
    const response = await this.payments.createIntentLifecycle({
      tenantId: input.tenantId,
      orderRef: input.orderRef,
      provider: input.provider,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
    if (response.status !== 201) {
      const message =
        (response.body as { message?: string } | null)?.message ?? "Payment could not be started";
      if (response.status === 422) throw new ValidationError(message);
      if (response.status === 409) throw new BusinessRuleError(message);
      throw new Error(
        `CheckoutPaymentInitiationAdapter: createIntentLifecycle failed for order "${input.orderRef}" ` +
          `(status ${response.status})`,
      );
    }
    const body = response.body as CreateIntentBody;
    return {
      paymentIntentId: body.paymentIntentId,
      status: body.status,
      provider: body.provider,
      ...(body.clientHandle !== undefined ? { clientHandle: body.clientHandle } : {}),
    };
  }
}
