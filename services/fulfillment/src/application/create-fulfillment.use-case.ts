import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import { FulfillmentItem } from "../domain/value-objects/fulfillment-item";

export interface CreateFulfillmentItemInput {
  readonly productRef: string;
  readonly quantity: number;
}

export interface CreateFulfillmentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderRef: string;
  readonly items: readonly CreateFulfillmentItemInput[];
}

export interface FulfillmentOrderStatusOutput {
  readonly fulfillmentOrderId: string;
  readonly status: string;
}

export interface CreateFulfillmentDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Opens a fulfillment order for an order's items — the entry point into the Sprint 4.9 lifecycle. */
export class CreateFulfillment implements UseCase<
  CreateFulfillmentInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: CreateFulfillmentDeps;

  constructor(deps: CreateFulfillmentDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateFulfillmentInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    const orderRef = Guard.againstEmpty(input.orderRef, "orderRef");
    if (!orderRef.ok) return err(orderRef.error);
    if (input.items.length === 0) {
      return err(
        new ValidationError("Invalid fulfillment order", [
          { field: "items", message: "must not be empty" },
        ]),
      );
    }

    const items: FulfillmentItem[] = [];
    for (const itemInput of input.items) {
      const productRef = ProductRef.create(itemInput.productRef);
      if (!productRef.ok) return err(productRef.error);
      const item = FulfillmentItem.create(productRef.value, itemInput.quantity);
      if (!item.ok) return err(item.error);
      items.push(item.value);
    }

    return this.deps.unitOfWork.run<Result<FulfillmentOrderStatusOutput, DomainError>>(
      async (tx) => {
        const id = UniqueEntityId.from(this.deps.idGenerator.generate());
        const fulfillmentOrder = FulfillmentOrder.create(id, input.orderRef, items);
        await this.deps.fulfillmentOrders.save(fulfillmentOrder, input.tenantId, tx);
        return ok({ fulfillmentOrderId: id.toString(), status: fulfillmentOrder.status.value });
      },
    );
  }
}
