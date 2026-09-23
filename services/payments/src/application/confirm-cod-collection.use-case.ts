import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import type { CaptureSettlementPort } from "./record-webhook.use-case";

export interface ConfirmCodCollectionInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
  /** What the operator (or, later, a courier integration) reports was actually collected. */
  readonly collectedAmountMinor: number;
  readonly currency: string;
}

export interface ConfirmCodCollectionOutput {
  readonly paymentIntentId: string;
  readonly status: string;
}

export interface ConfirmCodCollectionDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** The SAME settlement a card capture goes through (Charge, `payments.payment_intent.captured`, Orders/Finance side effects). */
  readonly captureSettlement: CaptureSettlementPort;
}

/**
 * The ONLY thing that marks a cash-on-delivery payment paid (WP-13 T13.4, decision 2).
 *
 * Creating the order, selecting COD, opening the intent, a generic capture request and a provider
 * webhook all leave a COD intent unpaid — `CashOnDeliveryProvider.capture` refuses and
 * `CapturePaymentLifecycle` rejects a capture of a direct-capture intent. What settles it is this
 * explicit operator action, behind its own permission, asserting cash was actually collected.
 *
 * Shaped like `CapturePaymentLifecycle`: a durable step first (walk the intent to
 * `capture_requested` in one committed transaction), then the shared `settle()` — so a crash in
 * between resumes cleanly, and a repeat call after settlement is a no-op that returns the recorded
 * outcome, never a second Charge. The source of truth is an operator's confirmation, not a
 * provider webhook: no courier integration exists to source it from (`services/shipping` has a
 * carrier port and a status webhook, but no real carrier adapter and no collected-amount field).
 *
 * Only a FULL collection is accepted: the reported amount must equal the amount due. A shortfall or
 * overage is not silently settled as paid.
 */
export class ConfirmCodCollection implements UseCase<
  ConfirmCodCollectionInput,
  ConfirmCodCollectionOutput,
  DomainError
> {
  private readonly deps: ConfirmCodCollectionDeps;

  constructor(deps: ConfirmCodCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: ConfirmCodCollectionInput,
  ): Promise<Result<ConfirmCodCollectionOutput, DomainError>> {
    const prepared = await this.deps.unitOfWork.run<
      Result<{ readonly alreadyCaptured: boolean }, DomainError>
    >(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx);
      if (intent === null) return err(new NotFoundError("Payment intent not found"));
      if (intent.provider !== "cod") {
        return err(
          new BusinessRuleError("Only a cash-on-delivery payment can be settled by a collection"),
        );
      }
      if (intent.status.value === "captured") return ok({ alreadyCaptured: true });

      if (
        input.collectedAmountMinor !== intent.amount.amountMinor ||
        input.currency.toUpperCase() !== intent.amount.currency
      ) {
        return err(
          new BusinessRuleError(
            "The collected amount must equal the amount due; partial or excess collection is not settled as paid",
          ),
        );
      }

      const before = intent.status.value;
      try {
        intent.prepareDirectCapture(() => this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      if (intent.status.value !== before) {
        await this.deps.intents.save(intent, input.tenantId, tx);
      }
      return ok({ alreadyCaptured: false });
    });
    if (!prepared.ok) return err(prepared.error);

    if (prepared.value.alreadyCaptured) {
      return ok({ paymentIntentId: input.paymentIntentId, status: "captured" });
    }
    const settled = await this.deps.captureSettlement.settle(input.paymentIntentId, input.tenantId);
    if (!settled.ok) return err(settled.error);
    return ok({ paymentIntentId: settled.value.paymentIntentId, status: settled.value.status });
  }
}
