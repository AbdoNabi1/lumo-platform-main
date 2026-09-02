import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { UserRepository } from "../domain/access-repositories";
import { User } from "../domain/user";
import { Email } from "../domain/value-objects/email";

export interface UserUseCaseDeps {
  readonly users: UserRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateUserInput {
  readonly tenantId: string;
  readonly email: string;
  readonly name: string;
}

export interface CreateUserOutput {
  readonly userId: string;
}

/** Creates a new user (email is the natural key, unique per tenant). */
export class CreateUser implements UseCase<CreateUserInput, CreateUserOutput, DomainError> {
  private readonly deps: UserUseCaseDeps;

  constructor(deps: UserUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: CreateUserInput): Promise<Result<CreateUserOutput, DomainError>> {
    const email = Email.create(input.email);
    if (!email.ok) return err(email.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CreateUserOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.users.findByEmail(email.value.value, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError("A user with this email already exists in this tenant"));
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const user = User.create(
        id,
        input.tenantId,
        email.value,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.users.save(user, tx);
      return ok({ userId: id.toString() });
    });
  }
}

export interface RenameUserInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
}

export interface RenameUserOutput {
  readonly userId: string;
  readonly name: string;
}

/** Renames an existing user. */
export class RenameUser implements UseCase<RenameUserInput, RenameUserOutput, DomainError> {
  private readonly deps: UserUseCaseDeps;

  constructor(deps: UserUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: RenameUserInput): Promise<Result<RenameUserOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<RenameUserOutput, DomainError>>(async (tx) => {
      const user = await this.deps.users.findById(input.userId, input.tenantId, tx);
      if (user === null) {
        return err(new NotFoundError("User not found"));
      }

      user.rename(input.name, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.users.save(user, tx);
      return ok({ userId: user.id.toString(), name: user.name });
    });
  }
}

export interface DeactivateUserInput {
  readonly tenantId: string;
  readonly userId: string;
}

export interface DeactivateUserOutput {
  readonly userId: string;
}

/** Deactivates a user. */
export class DeactivateUser implements UseCase<
  DeactivateUserInput,
  DeactivateUserOutput,
  DomainError
> {
  private readonly deps: UserUseCaseDeps;

  constructor(deps: UserUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: DeactivateUserInput): Promise<Result<DeactivateUserOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeactivateUserOutput, DomainError>>(async (tx) => {
      const user = await this.deps.users.findById(input.userId, input.tenantId, tx);
      if (user === null) {
        return err(new NotFoundError("User not found"));
      }

      try {
        user.deactivate(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.users.save(user, tx);
      return ok({ userId: user.id.toString() });
    });
  }
}
