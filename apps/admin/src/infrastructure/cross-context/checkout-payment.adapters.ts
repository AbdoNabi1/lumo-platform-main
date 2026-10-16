import type { PaymentInitiationPort, PaymentMethodPort } from "@platform/checkout";
import type { OrderController } from "@platform/orders";
import type { MerchantPaymentSettingsDto, PaymentController } from "@platform/payments";
import {
  BusinessRuleError,
  type Logger,
  logger as defaultLogger,
  ValidationError,
} from "@platform/utils";

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
 *
 * Plan 3B (closes G-121): right after the intent is opened, Orders is told which payment belongs to
 * the order (`recordCheckoutPayment`), so the order reaches `payment_requested` and the capture that
 * follows — a card's, or a confirmed cash collection's — can mark it paid. That link is BEST-EFFORT:
 * the intent already exists and the shopper's payment must not fail because Orders refused or was
 * unreachable, so a failure is logged (the order id only — no name, phone or email) and the intent is
 * returned. The storefront retry path never gets here twice: `InitiatePayment` returns the session's
 * recorded intent without calling this adapter.
 */
export class CheckoutPaymentInitiationAdapter implements PaymentInitiationPort {
  private readonly payments: Pick<PaymentController, "createIntentLifecycle">;
  private readonly orders: Pick<OrderController, "recordCheckoutPayment">;
  private readonly logger: Logger;

  constructor(
    payments: Pick<PaymentController, "createIntentLifecycle">,
    orders: Pick<OrderController, "recordCheckoutPayment">,
    logger: Logger = defaultLogger,
  ) {
    this.payments = payments;
    this.orders = orders;
    this.logger = logger;
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
    await this.linkPaymentToOrder(input.tenantId, input.orderRef, body.paymentIntentId);
    return {
      paymentIntentId: body.paymentIntentId,
      status: body.status,
      provider: body.provider,
      ...(body.clientHandle !== undefined ? { clientHandle: body.clientHandle } : {}),
    };
  }

  /** Best-effort: never throws, never fails the shopper's payment. Logs the order id and status only. */
  private async linkPaymentToOrder(
    tenantId: string,
    orderId: string,
    paymentRef: string,
  ): Promise<void> {
    try {
      const linked = await this.orders.recordCheckoutPayment({ tenantId, orderId, paymentRef });
      if (linked.status !== 200) {
        this.logger.warn(
          "CheckoutPaymentInitiationAdapter: could not link the payment to its order",
          {
            orderId,
            status: linked.status,
          },
        );
      }
    } catch {
      this.logger.warn(
        "CheckoutPaymentInitiationAdapter: could not link the payment to its order",
        {
          orderId,
        },
      );
    }
  }
}
