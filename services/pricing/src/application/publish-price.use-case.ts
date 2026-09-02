import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PriceRepository } from "../domain/price-repository";

export interface PublishPriceInput {
  readonly priceId: string;
}

export interface PublishPriceOutput {
  readonly id: string;
  readonly status: string;
}

export interface PublishPriceDeps {
  readonly prices: PriceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Publishes a draft price, emitting `price.published`. */
export class PublishPrice implements UseCase<PublishPriceInput, PublishPriceOutput, DomainError> {
  private readonly deps: PublishPriceDeps;

  constructor(deps: PublishPriceDeps) {
    this.deps = deps;
  }

  async execute(input: PublishPriceInput): Promise<Result<PublishPriceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PublishPriceOutput, DomainError>>(async (tx) => {
      const price = await this.deps.prices.findById(input.priceId, tx);
      if (price === null) {
        return err(new NotFoundError("Price not found"));
      }

      try {
        price.publish(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.prices.save(price, tx);
      return ok({ id: price.id.toString(), status: price.status });
    });
  }
}
