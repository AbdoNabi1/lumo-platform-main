import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { PaymentIntentBatchReader } from "../domain/payment-intent-repository";
import {
  isCollectedOnDelivery,
  isSettledByOperatorConfirmation,
} from "../domain/value-objects/provider-capabilities";
import type { ProviderCapabilityLookup } from "./ports";

/** One export page of orders (spec §1.4). */
export const MAX_PAYMENT_INTENTS_PER_READ = 250;

export interface GetPaymentIntentsByIdsInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentIds: readonly string[];
}

/** What an order screen may know about a payment — never the aggregate (no PSP refs, no charges). */
export interface PaymentIntentSummary {
  readonly id: string;
  readonly orderRef: string;
  readonly provider: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** The provider settles when the shopper pays — no separate capture step (cash on delivery, Paymob). */
  readonly settlesAtPayTime: boolean;
  /** Only an operator confirming the money arrived settles it (cash on delivery) — by capability, not name. */
  readonly settledByOperatorConfirmation: boolean;
  /** Cash a courier collects on delivery — by capability (Ruling 9); false for a staff-recorded payment. */
  readonly collectedOnDelivery: boolean;
}

export interface GetPaymentIntentsByIdsDeps {
  readonly intents: PaymentIntentBatchReader;
  readonly providers: ProviderCapabilityLookup;
}

/** Many intents in one read, each with its provider's declared capabilities (an unregistered provider has none). */
export class GetPaymentIntentsByIds implements UseCase<
  GetPaymentIntentsByIdsInput,
  readonly PaymentIntentSummary[],
  DomainError
> {
  private readonly deps: GetPaymentIntentsByIdsDeps;

  constructor(deps: GetPaymentIntentsByIdsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetPaymentIntentsByIdsInput,
  ): Promise<Result<readonly PaymentIntentSummary[], DomainError>> {
    const ids = [...new Set(input.paymentIntentIds)];
    if (ids.length > MAX_PAYMENT_INTENTS_PER_READ) {
      return err(
        new ValidationError(`At most ${MAX_PAYMENT_INTENTS_PER_READ} payment intents per read`, [
          {
            field: "paymentIntentIds",
            message: `must hold at most ${MAX_PAYMENT_INTENTS_PER_READ} ids`,
          },
        ]),
      );
    }
    if (ids.length === 0) return ok([]);
    const intents = await this.deps.intents.findByIds(ids, input.tenantId);
    return ok(
      intents.map((intent) => {
        const capabilities = this.deps.providers.capabilitiesOf(intent.provider);
        return {
          id: intent.id.toString(),
          orderRef: intent.orderRef,
          provider: intent.provider,
          status: intent.status.value,
          amountMinor: intent.amount.amountMinor,
          currency: intent.amount.currency,
          settlesAtPayTime: capabilities?.settlesAtPayTime ?? false,
          settledByOperatorConfirmation:
            capabilities !== undefined && isSettledByOperatorConfirmation(capabilities),
          collectedOnDelivery: capabilities !== undefined && isCollectedOnDelivery(capabilities),
        };
      }),
    );
  }
}
