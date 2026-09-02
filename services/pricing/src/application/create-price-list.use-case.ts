import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { PriceList } from "../domain/price-list";
import type { PriceListRepository } from "../domain/price-list-repository";
import { Currency } from "../domain/value-objects/currency";

export interface CreatePriceListInput {
  readonly name: string;
  readonly currency: string;
}

export interface CreatePriceListOutput {
  readonly id: string;
}

export interface CreatePriceListDeps {
  readonly priceLists: PriceListRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Creates a draft price list. */
export class CreatePriceList implements UseCase<
  CreatePriceListInput,
  CreatePriceListOutput,
  DomainError
> {
  private readonly deps: CreatePriceListDeps;

  constructor(deps: CreatePriceListDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePriceListInput): Promise<Result<CreatePriceListOutput, DomainError>> {
    const currency = Currency.create(input.currency);
    if (!currency.ok) return err(currency.error);

    return this.deps.unitOfWork.run<Result<CreatePriceListOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const priceList = PriceList.create(id, input.name, currency.value);
      await this.deps.priceLists.save(priceList, tx);
      return ok({ id: id.toString() });
    });
  }
}
