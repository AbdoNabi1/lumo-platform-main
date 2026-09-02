import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { ReturnItem } from "../domain/value-objects/return-item";
import { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";
import { ReturnReason } from "../domain/value-objects/return-reason";

export interface CreateReturnRequestItemInput {
  readonly orderItemRef: string;
  readonly productRef: string;
  readonly quantity: number;
  readonly reasonCode: string;
  readonly reasonNote?: string;
}

export interface CreateReturnRequestInput {
  readonly orderRef: string;
  readonly items: readonly CreateReturnRequestItemInput[];
}

export interface ReturnStatusOutput {
  readonly returnId: string;
  readonly status: string;
}

export interface CreateReturnRequestDeps {
  readonly returns: ReturnRequestRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Opens a return request (RMA) for an order's items — the entry point into the Sprint 4.11 lifecycle. */
export class CreateReturnRequest implements UseCase<
  CreateReturnRequestInput,
  ReturnStatusOutput,
  DomainError
> {
  private readonly deps: CreateReturnRequestDeps;

  constructor(deps: CreateReturnRequestDeps) {
    this.deps = deps;
  }

  async execute(input: CreateReturnRequestInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    const orderRef = Guard.againstEmpty(input.orderRef, "orderRef");
    if (!orderRef.ok) return err(orderRef.error);
    if (input.items.length === 0) {
      return err(
        new ValidationError("Invalid return request", [
          { field: "items", message: "must not be empty" },
        ]),
      );
    }

    const items: ReturnItem[] = [];
    for (const itemInput of input.items) {
      const productRef = ProductRef.create(itemInput.productRef);
      if (!productRef.ok) return err(productRef.error);
      const reason = ReturnReason.create(itemInput.reasonCode, itemInput.reasonNote);
      if (!reason.ok) return err(reason.error);
      items.push(
        ReturnItem.create(
          UniqueEntityId.from(itemInput.orderItemRef),
          itemInput.orderItemRef,
          productRef.value,
          itemInput.quantity,
          reason.value,
        ),
      );
    }

    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const returnRequest = ReturnRequest.create(id, input.orderRef, items);
      await this.deps.returns.save(returnRequest, tx);
      return ok({ returnId: id.toString(), status: returnRequest.status.value });
    });
  }
}
