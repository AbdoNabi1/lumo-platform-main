import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { Brand } from "../domain/brand";
import type { BrandRepository } from "../domain/brand-repository";
import { Slug } from "../domain/value-objects/slug";

export interface CreateBrandInput {
  readonly name: string;
  readonly slug: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface CreateBrandOutput {
  readonly id: string;
}

export interface CreateBrandDeps {
  readonly brands: BrandRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a brand (slug is the natural key). */
export class CreateBrand implements UseCase<CreateBrandInput, CreateBrandOutput, DomainError> {
  private readonly deps: CreateBrandDeps;

  constructor(deps: CreateBrandDeps) {
    this.deps = deps;
  }

  async execute(input: CreateBrandInput): Promise<Result<CreateBrandOutput, DomainError>> {
    const slug = Slug.create(input.slug);
    if (!slug.ok) return err(slug.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CreateBrandOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.brands.findBySlug(slug.value.value, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError("A brand with this slug already exists"));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const brand = Brand.create(
        id,
        input.name,
        slug.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.brands.save(brand, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}
