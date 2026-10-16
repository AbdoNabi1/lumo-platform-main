import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { OrderRepository } from "../domain/order-repository";
import { type OrderStatusOutput, withConcurrencyRetry } from "./order-lifecycle.use-cases";

export interface RecordCheckoutPaymentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderId: string;
  /** The payment intent Payments opened for this order's checkout. */
  readonly paymentRef: string;
}

export interface RecordCheckoutPaymentDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Tells Orders which payment was opened for a checkout order (closes G-121).
 *
 * Checkout leaves an order at `created` and Payments then opens an intent for it, but nothing told
 * Orders — so `order.paymentRef` stayed empty and `PaymentCapturedConsumer` (which only pays an order
 * at `payment_requested`) refused every capture, including a confirmed cash-on-delivery collection.
 * This walks the order through the EXISTING transition table, unchanged:
 * `created → confirmed → awaiting_payment → payment_requested(paymentRef)`, in one save, so the
 * capture that follows takes it to `payment_received`.
 *
 * Idempotent: the same `paymentRef` on an order already at `payment_requested` (or later) is ok and
 * records nothing. Anything else — a cancelled order, one already moved along by hand, or a
 * different `paymentRef` — is a `BusinessRuleError`. The caller treats that as best-effort: it logs
 * and does NOT fail the shopper's payment.
 */
export class RecordCheckoutPayment implements UseCase<
  RecordCheckoutPaymentInput,
  OrderStatusOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;
  private readonly deps: RecordCheckoutPaymentDeps;

  constructor(deps: RecordCheckoutPaymentDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordCheckoutPaymentInput,
  ): Promise<Result<OrderStatusOutput, DomainError>> {
    return withConcurrencyRetry(RecordCheckoutPayment.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<OrderStatusOutput, DomainError>>(async (tx) => {
        const order = await this.deps.orders.findById(input.orderId, input.tenantId, tx);
        if (order === null) {
          return err(new NotFoundError("Order not found"));
        }

        if (order.paymentRef !== undefined) {
          if (order.paymentRef === input.paymentRef) {
            return ok({ orderId: order.id.toString(), status: order.status });
          }
          return err(new BusinessRuleError("Order is already linked to a different payment"));
        }
        if (order.status !== "created") {
          return err(
            new BusinessRuleError(
              `Cannot record a payment for an order in status "${order.status}"`,
            ),
          );
        }

        try {
          const now = this.deps.clock.now();
          order.confirm(this.deps.idGenerator.generate(), now);
          order.markAwaitingPayment(this.deps.idGenerator.generate(), now);
          order.requestPayment(input.paymentRef, this.deps.idGenerator.generate(), now);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.orders.save(order, input.tenantId, tx);
        return ok({ orderId: order.id.toString(), status: order.status });
      }),
    );
  }
}
