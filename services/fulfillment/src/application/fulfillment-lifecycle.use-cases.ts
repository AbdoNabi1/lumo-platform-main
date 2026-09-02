import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { FulfillmentOrder } from "../domain/fulfillment-order";
import type { FulfillmentOrderRepository } from "../domain/fulfillment-order-repository";
import type { FulfillmentStatusValue } from "../domain/value-objects/fulfillment-status";
import type { FulfillmentOrderStatusOutput } from "./create-fulfillment.use-case";
import type { NotificationPort, OrdersPort } from "./ports";

export interface FulfillmentOrderIdInput {
  readonly fulfillmentOrderId: string;
}

export interface AdvanceFulfillmentInput extends FulfillmentOrderIdInput {
  readonly toStatus: FulfillmentStatusValue;
}

export interface FulfillmentLifecycleDeps {
  readonly fulfillmentOrders: FulfillmentOrderRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly ordersPort?: OrdersPort;
  readonly notifications?: NotificationPort;
}

export async function notifyBestEffort(
  deps: FulfillmentLifecycleDeps,
  fulfillmentOrder: FulfillmentOrder,
): Promise<void> {
  try {
    await deps.ordersPort?.reportFulfillmentOutcome(
      fulfillmentOrder.orderRef,
      fulfillmentOrder.status.value,
    );
    await deps.notifications?.notify(fulfillmentOrder.orderRef, fulfillmentOrder.status.value);
  } catch {
    // Best-effort: a reference-only notification failure never fails the transition's own result.
  }
}

/** Generic validated transition — moves a fulfillment order to any status its current status's transition table allows, then fans out Orders/Notifications best-effort. */
export class AdvanceFulfillment implements UseCase<
  AdvanceFulfillmentInput,
  FulfillmentOrderStatusOutput,
  DomainError
> {
  private readonly deps: FulfillmentLifecycleDeps;

  constructor(deps: FulfillmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceFulfillmentInput,
  ): Promise<Result<FulfillmentOrderStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FulfillmentOrderStatusOutput, DomainError>>(
      async (tx) => {
        const fulfillmentOrder = await this.deps.fulfillmentOrders.findById(
          input.fulfillmentOrderId,
          tx,
        );
        if (fulfillmentOrder === null) {
          return err(new NotFoundError("Fulfillment order not found"));
        }

        try {
          fulfillmentOrder.transition(
            input.toStatus,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.fulfillmentOrders.save(fulfillmentOrder, tx);
        await notifyBestEffort(this.deps, fulfillmentOrder);
        return ok({
          fulfillmentOrderId: fulfillmentOrder.id.toString(),
          status: fulfillmentOrder.status.value,
        });
      },
    );
  }
}
