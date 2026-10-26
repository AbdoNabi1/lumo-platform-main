import type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Raised for a `PaymentProvider` operation a staff-recorded payment has no faithful equivalent for. */
export class ManualPaymentUnsupportedOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`Manual payment does not support "${operation}": ${reason}`);
    this.name = "ManualPaymentUnsupportedOperationError";
    this.operation = operation;
  }
}

/**
 * Order operations Part 4 — "Mark as paid" on a draft order: money the merchant already received outside
 * the platform (bank transfer, InstaPay, wallet). Like cash on delivery there is no PSP: the intent opens
 * unpaid, `capture` refuses (only `ConfirmCodCollection`, an admin's explicit confirmation, settles it),
 * `refund` refuses (it is returned outside the platform; `RefundPaymentLifecycle` records it by
 * capability), `cancel` is a true no-op and no webhook is authentic. Stateless; one instance is shared.
 */
export class ManualPaymentProvider implements PaymentProvider {
  createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
    return Promise.resolve({ providerIntentId: `manual:${request.idempotencyKey}` });
  }

  capture(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new ManualPaymentUnsupportedOperationError("capture", "confirm the received payment instead"),
    );
  }

  cancel(_providerIntentId: string, _idempotencyKey: string): Promise<void> {
    return Promise.resolve();
  }

  refund(_providerIntentId: string, _amountMinor: number, _idempotencyKey: string): Promise<void> {
    return Promise.reject(
      new ManualPaymentUnsupportedOperationError(
        "refund",
        "a manual payment is returned outside the platform",
      ),
    );
  }

  verifyWebhook(_payload: Uint8Array, _signature: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
