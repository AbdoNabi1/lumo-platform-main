import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError } from "@platform/utils";
import { Price } from "../domain/price";
import type { PriceRepository } from "../domain/price-repository";

export interface CreatePriceInput {
  readonly priceListId: string;
  readonly productId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor?: number;
  readonly costMinor?: number;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly taxClassRef?: string;
}

export interface CreatePriceOutput {
  readonly id: string;
}

export interface CreatePriceDeps {
  readonly prices: PriceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Creates a price for a product within a price list (the price list is referenced by id). Accepts optional compare-at/cost (same currency), effective window, and tax class (Sprint 4.4). */
export class CreatePrice implements UseCase<CreatePriceInput, CreatePriceOutput, DomainError> {
  private readonly deps: CreatePriceDeps;

  constructor(deps: CreatePriceDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePriceInput): Promise<Result<CreatePriceOutput, DomainError>> {
    const product = ProductRef.create(input.productId);
    if (!product.ok) return err(product.error);
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

    return this.deps.unitOfWork.run<Result<CreatePriceOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      let price: Price;
      try {
        price = Price.create(id, input.priceListId, product.value, amount.value, {
          compareAt,
          cost,
        });
        if (input.effectiveFrom !== undefined || input.effectiveTo !== undefined) {
          price.setEffectiveWindow(
            input.effectiveFrom !== undefined ? new Date(input.effectiveFrom) : undefined,
            input.effectiveTo !== undefined ? new Date(input.effectiveTo) : undefined,
          );
        }
        if (input.taxClassRef !== undefined) {
          price.assignTaxClass(input.taxClassRef);
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.prices.save(price, tx);
      return ok({ id: id.toString() });
    });
  }
}
