import type { UseCase } from "@platform/application";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PriceListRepository } from "../domain/price-list-repository";

export interface ActivatePriceListInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly priceListId: string;
}

export interface ActivatePriceListOutput {
  readonly id: string;
}

export interface ActivatePriceListDeps {
  readonly priceLists: PriceListRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Activates a draft price list. */
export class ActivatePriceList implements UseCase<
  ActivatePriceListInput,
  ActivatePriceListOutput,
  DomainError
> {
  private readonly deps: ActivatePriceListDeps;

  constructor(deps: ActivatePriceListDeps) {
    this.deps = deps;
  }

  async execute(
    input: ActivatePriceListInput,
  ): Promise<Result<ActivatePriceListOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ActivatePriceListOutput, DomainError>>(async (tx) => {
      const priceList = await this.deps.priceLists.findById(input.priceListId, input.tenantId, tx);
      if (priceList === null) {
        return err(new NotFoundError("Price list not found"));
      }

      try {
        priceList.activate();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.priceLists.save(priceList, input.tenantId, tx);
      return ok({ id: priceList.id.toString() });
    });
  }
}
