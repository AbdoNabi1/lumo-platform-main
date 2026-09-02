import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { BrandRepository } from "../domain/brand-repository";

export interface DeleteBrandInput {
  readonly brandId: string;
}

export interface DeleteBrandOutput {
  readonly brandId: string;
}

export interface DeleteBrandDeps {
  readonly brands: BrandRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Soft-deletes a brand. */
export class DeleteBrand implements UseCase<DeleteBrandInput, DeleteBrandOutput, DomainError> {
  private readonly deps: DeleteBrandDeps;

  constructor(deps: DeleteBrandDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteBrandInput): Promise<Result<DeleteBrandOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeleteBrandOutput, DomainError>>(async (tx) => {
      const brand = await this.deps.brands.findById(input.brandId, tx);
      if (brand === null) {
        return err(new NotFoundError("Brand not found"));
      }
      try {
        brand.delete(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.brands.delete(brand, tx);
      return ok({ brandId: brand.id.toString() });
    });
  }
}
