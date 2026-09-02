import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { PriceRepository } from "../domain/price-repository";

export interface ChangePriceInput {
  readonly priceId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor?: number;
  readonly costMinor?: number;
}

export interface ChangePriceOutput {
  readonly id: string;
}

export interface ChangePriceDeps {
  readonly prices: PriceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Changes a price's amount (and optionally compare-at/cost, same currency), emitting `price.changed`. */
export class ChangePrice implements UseCase<ChangePriceInput, ChangePriceOutput, DomainError> {
  private readonly deps: ChangePriceDeps;

  constructor(deps: ChangePriceDeps) {
    this.deps = deps;
  }

  async execute(input: ChangePriceInput): Promise<Result<ChangePriceOutput, DomainError>> {
    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    let compareAt: Money | undefined;
    if (input.compareAtMinor !== undefined) {
      const result = Money.create(input.compareAtMinor, input.currency);
      if (!result.ok) return err(result.error);
      compareAt = result.value;
    }
    let cost: Money | undefined;
    if (input.costMinor !== undefined) {
      const result = Money.create(input.costMinor, input.currency);
      if (!result.ok) return err(result.error);
      cost = result.value;
    }

    return this.deps.unitOfWork.run<Result<ChangePriceOutput, DomainError>>(async (tx) => {
      const price = await this.deps.prices.findById(input.priceId, tx);
      if (price === null) {
        return err(new NotFoundError("Price not found"));
      }

      try {
        price.change(amount.value, this.deps.idGenerator.generate(), this.deps.clock.now(), {
          compareAt,
          cost,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.prices.save(price, tx);
      return ok({ id: price.id.toString() });
    });
  }
}
