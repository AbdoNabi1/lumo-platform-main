import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { ExampleAggregate } from "../domain/example-aggregate";
import type { ExampleRepository } from "../domain/example-repository";

export interface RegisterExampleInput {
  readonly label: string;
}

export interface RegisterExampleOutput {
  readonly id: string;
}

export interface RegisterExampleDeps {
  readonly examples: ExampleRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Reference use-case for the walking skeleton (NON-business). Creates an {@link ExampleAggregate}
 * and persists it within a transaction. Depends only on the domain + ports (`@platform/contracts`,
 * `@platform/repository`) — never on messaging or infrastructure. The outbox write is the
 * repository's (infrastructure) responsibility, preserving `application ← messaging`.
 */
export class RegisterExample implements UseCase<
  RegisterExampleInput,
  RegisterExampleOutput,
  DomainError
> {
  private readonly deps: RegisterExampleDeps;

  constructor(deps: RegisterExampleDeps) {
    this.deps = deps;
  }

  async execute(input: RegisterExampleInput): Promise<Result<RegisterExampleOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RegisterExampleOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const example = ExampleAggregate.register(
        id,
        input.label,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.examples.save(example, tx);
      return ok({ id: id.toString() });
    });
  }
}
