import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { TaxClass } from "../domain/tax-class";
import type { TaxClassRepository } from "../domain/tax-class-repository";

export interface CreateTaxClassInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
}

export interface CreateTaxClassOutput {
  readonly id: string;
}

export interface CreateTaxClassDeps {
  readonly taxClasses: TaxClassRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a tax classification. `code` must be unique per tenant. Classification only — computes no tax (ADR-0024). */
export class CreateTaxClass implements UseCase<
  CreateTaxClassInput,
  CreateTaxClassOutput,
  DomainError
> {
  private readonly deps: CreateTaxClassDeps;

  constructor(deps: CreateTaxClassDeps) {
    this.deps = deps;
  }

  async execute(input: CreateTaxClassInput): Promise<Result<CreateTaxClassOutput, DomainError>> {
    const code = Guard.againstEmpty(input.code, "code");
    if (!code.ok) return err(code.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CreateTaxClassOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.taxClasses.findByCode(input.code, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Tax class code '${input.code}' is already in use`));
      }

      const taxClass = TaxClass.create(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        input.code,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.taxClasses.save(taxClass, input.tenantId, tx);
      return ok({ id: taxClass.id.toString() });
    });
  }
}
