import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { OrderRepository } from "../domain/order-repository";
import type { PaymentTruthShadowPort } from "./payment-truth-shadow";
import type { PaymentVerificationPort } from "./ports";

export interface MarkOrderPaidInput {
  readonly orderId: string;
  readonly paymentRef: string;
}

export interface MarkOrderPaidOutput {
  readonly orderId: string;
  readonly status: string;
}

export interface MarkOrderPaidDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Shadow-mode prep only (Sprint A1 Task 4) — optional, unwired by default, no behavior change. */
  readonly shadow?: PaymentTruthShadowPort;
  /**
   * Gates a caller-asserted `paymentRef` against Payments before it can complete an order
   * (Sprint A1 Task 5 — closes the remaining "no bare non-empty-string check" gap). Optional: when
   * unwired, behavior is unchanged from before this field existed (matches every other in-memory
   * default in this codebase — `InMemoryShippingAdapter.verifyReturnShipment` etc. — which is
   * exactly what the default `InMemoryPaymentVerificationAdapter` does).
   */
  readonly paymentVerification?: PaymentVerificationPort;
}

/**
 * Marks an order paid (e.g. on `payment.captured`) — the ONE authoritative "payment completed" path
 * (Sprint A1 — Payment Truth Foundation), used by both the admin backoffice mark-paid action and
 * `PaymentCapturedConsumer`. Delegates to `Order.completePayment`, which handles the legacy
 * (`placed` → `paid`, emits `order.paid`) and checkout/saga (→ `payment_received`, emits
 * `order.transitioned`) lifecycles uniformly.
 */
export class MarkOrderPaid implements UseCase<
  MarkOrderPaidInput,
  MarkOrderPaidOutput,
  DomainError
> {
  private readonly deps: MarkOrderPaidDeps;

  constructor(deps: MarkOrderPaidDeps) {
    this.deps = deps;
  }

  async execute(input: MarkOrderPaidInput): Promise<Result<MarkOrderPaidOutput, DomainError>> {
    const paymentRef = Guard.againstEmpty(input.paymentRef, "paymentRef");
    if (!paymentRef.ok) return err(paymentRef.error);

    if (this.deps.paymentVerification !== undefined) {
      const verified = await this.deps.paymentVerification.hasCapturedPayment(
        input.orderId,
        input.paymentRef,
      );
      if (!verified) {
        return err(
          new ValidationError("No captured payment found for this reference on this order", [
            { field: "paymentRef", message: "could not be verified against Payments" },
          ]),
        );
      }
    }

    return this.deps.unitOfWork.run<Result<MarkOrderPaidOutput, DomainError>>(async (tx) => {
      const order = await this.deps.orders.findById(input.orderId, tx);
      if (order === null) {
        return err(new NotFoundError("Order not found"));
      }

      try {
        order.completePayment(
          input.paymentRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.orders.save(order, tx);
      this.deps.shadow?.observe({
        orderId: order.id.toString(),
        paymentRef: input.paymentRef,
        resultingStatus: order.status,
      });
      return ok({ orderId: order.id.toString(), status: order.status });
    });
  }
}
