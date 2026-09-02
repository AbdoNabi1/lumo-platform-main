import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";

export interface GetFulfillmentByOrderInput {
  readonly orderRef: string;
}

export interface GetFulfillmentByOrderDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
}

/** Reads the fulfillment order opened for a given order, if any (Phase A.30 admin Order Detail panel). */
export class GetFulfillmentByOrder implements UseCase<
  GetFulfillmentByOrderInput,
  FulfillmentOrder,
  DomainError
> {
  private readonly deps: GetFulfillmentByOrderDeps;

  constructor(deps: GetFulfillmentByOrderDeps) {
    this.deps = deps;
  }

  async execute(input: GetFulfillmentByOrderInput): Promise<Result<FulfillmentOrder, DomainError>> {
    const fulfillmentOrder = await this.deps.fulfillmentOrders.findByOrderRef(input.orderRef);
    if (fulfillmentOrder === null) {
      return err(new NotFoundError("No fulfillment order found for this order"));
    }
    return ok(fulfillmentOrder);
  }
}
