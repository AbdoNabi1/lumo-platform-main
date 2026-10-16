import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Order } from "../domain/order";
import type { OrderRepository } from "../domain/order-repository";

export interface GetOrderInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderId: string;
}

export interface GetOrderDeps {
  readonly orders: OrderRepository;
}

/** Reads a single order by id (generic, no dedicated report names this use-case — matrix Medium confidence). */
export class GetOrder implements UseCase<GetOrderInput, Order, DomainError> {
  private readonly deps: GetOrderDeps;

  constructor(deps: GetOrderDeps) {
    this.deps = deps;
  }

  async execute(input: GetOrderInput): Promise<Result<Order, DomainError>> {
    const order = await this.deps.orders.findById(input.orderId, input.tenantId);
    if (order === null) {
      return err(new NotFoundError("Order not found"));
    }
    return ok(order);
  }
}
