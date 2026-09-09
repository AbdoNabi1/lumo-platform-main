import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface SchedulePublishProductInput {
  readonly productId: string;
  readonly scheduledAt: Date;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface SchedulePublishProductOutput {
  readonly productId: string;
  readonly scheduledAt: string;
}

export interface SchedulePublishProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
}

/** Schedules a draft product to publish at a future time. */
export class SchedulePublishProduct implements UseCase<
  SchedulePublishProductInput,
  SchedulePublishProductOutput,
  DomainError
> {
  private readonly deps: SchedulePublishProductDeps;

  constructor(deps: SchedulePublishProductDeps) {
    this.deps = deps;
  }

  async execute(
    input: SchedulePublishProductInput,
  ): Promise<Result<SchedulePublishProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SchedulePublishProductOutput, DomainError>>(
      async (tx) => {
        const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
        if (product === null) {
          return err(new NotFoundError("Product not found"));
        }
        try {
          product.schedulePublish(input.scheduledAt, this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.products.save(product, tx);
        return ok({
          productId: product.id.toString(),
          scheduledAt: input.scheduledAt.toISOString(),
        });
      },
    );
  }
}
