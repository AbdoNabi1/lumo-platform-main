import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { BrandRepository } from "../domain/brand-repository";

export interface UpdateBrandInput {
  readonly id: string;
  readonly name: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UpdateBrandOutput {
  readonly id: string;
  readonly name: string;
}

export interface UpdateBrandDeps {
  readonly brands: BrandRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Renames a brand. */
export class UpdateBrand implements UseCase<UpdateBrandInput, UpdateBrandOutput, DomainError> {
  private readonly deps: UpdateBrandDeps;

  constructor(deps: UpdateBrandDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateBrandInput): Promise<Result<UpdateBrandOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<UpdateBrandOutput, DomainError>>(async (tx) => {
      const brand = await this.deps.brands.findById(input.id, input.tenantId, tx);
      if (brand === null) {
        return err(new NotFoundError("Brand not found"));
      }
      brand.update(input.name, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.brands.save(brand, input.tenantId, tx);
      return ok({ id: brand.id.toString(), name: brand.name });
    });
  }
}
