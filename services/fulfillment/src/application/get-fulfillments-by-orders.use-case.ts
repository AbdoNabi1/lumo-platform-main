import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";

export interface GetFulfillmentsByOrdersInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderRefs: readonly string[];
}

export interface GetFulfillmentsByOrdersDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
}

/**
 * Reads the fulfillment orders of a whole page of orders in ONE repository read (Plan 3B — the admin
 * orders list shows each order's fulfillment status). Orders with no fulfillment order are simply
 * absent from the answer; there is never a per-order call.
 */
export class GetFulfillmentsByOrders implements UseCase<
  GetFulfillmentsByOrdersInput,
  readonly FulfillmentOrder[],
  DomainError
> {
  private readonly deps: GetFulfillmentsByOrdersDeps;

  constructor(deps: GetFulfillmentsByOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetFulfillmentsByOrdersInput,
  ): Promise<Result<readonly FulfillmentOrder[], DomainError>> {
    const found = await this.deps.fulfillmentOrders.findByOrderRefs(
      input.orderRefs,
      input.tenantId,
    );
    return ok([...found.values()]);
  }
}
