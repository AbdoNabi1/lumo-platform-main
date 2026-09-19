import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { OrderRepository } from "../domain/order-repository";
import { RefundPolicy } from "../domain/refund-policy";

export interface RefundOrderInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderId: string;
}

export interface RefundOrderOutput {
  readonly orderId: string;
  readonly status: string;
}

export interface RefundOrderDeps {
  readonly orders: OrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Refunds a paid order (subject to {@link RefundPolicy}), emitting `order.refunded`. */
export class RefundOrder implements UseCase<RefundOrderInput, RefundOrderOutput, DomainError> {
  private readonly deps: RefundOrderDeps;
  private readonly refundPolicy = new RefundPolicy();

  constructor(deps: RefundOrderDeps) {
    this.deps = deps;
  }

  async execute(input: RefundOrderInput): Promise<Result<RefundOrderOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RefundOrderOutput, DomainError>>(async (tx) => {
      const order = await this.deps.orders.findById(input.orderId, input.tenantId, tx);
      if (order === null) {
        return err(new NotFoundError("Order not found"));
      }

      try {
        order.refund(this.refundPolicy, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.orders.save(order, input.tenantId, tx);
      return ok({ orderId: order.id.toString(), status: order.status });
    });
  }
}
