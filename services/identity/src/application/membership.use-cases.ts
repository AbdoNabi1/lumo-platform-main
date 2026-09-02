import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, NotFoundError } from "@platform/utils";
import type { MembershipRepository } from "../domain/access-repositories";
import { Membership } from "../domain/membership";
import { RoleName } from "../domain/value-objects/role-name";

export interface MembershipUseCaseDeps {
  readonly memberships: MembershipRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface AddMembershipInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly roleName: string;
}

export interface AddMembershipOutput {
  readonly membershipId: string;
}

/** Adds a user to an organization with a role NAME reference (unique per user/organization pair). */
export class AddMembership implements UseCase<
  AddMembershipInput,
  AddMembershipOutput,
  DomainError
> {
  private readonly deps: MembershipUseCaseDeps;

  constructor(deps: MembershipUseCaseDeps) {
    this.deps = deps;
  }

  async execute(input: AddMembershipInput): Promise<Result<AddMembershipOutput, DomainError>> {
    const roleName = RoleName.create(input.roleName);
    if (!roleName.ok) return err(roleName.error);

    return this.deps.unitOfWork.run<Result<AddMembershipOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.memberships.findByUserAndOrganization(
        input.userId,
        input.organizationId,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(new ConflictError("This user is already a member of this organization"));
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const membership = Membership.create(
        id,
        input.tenantId,
        input.userId,
        input.organizationId,
        roleName.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.memberships.save(membership, tx);
      return ok({ membershipId: id.toString() });
    });
  }
}

export interface ChangeMembershipRoleInput {
  readonly tenantId: string;
  readonly membershipId: string;
  readonly roleName: string;
}

export interface ChangeMembershipRoleOutput {
  readonly membershipId: string;
  readonly roleName: string;
}

/** Changes an existing membership's role NAME reference. */
export class ChangeMembershipRole implements UseCase<
  ChangeMembershipRoleInput,
  ChangeMembershipRoleOutput,
  DomainError
> {
  private readonly deps: MembershipUseCaseDeps;

  constructor(deps: MembershipUseCaseDeps) {
    this.deps = deps;
  }

  async execute(
    input: ChangeMembershipRoleInput,
  ): Promise<Result<ChangeMembershipRoleOutput, DomainError>> {
    const roleName = RoleName.create(input.roleName);
    if (!roleName.ok) return err(roleName.error);

    return this.deps.unitOfWork.run<Result<ChangeMembershipRoleOutput, DomainError>>(async (tx) => {
      const membership = await this.deps.memberships.findById(
        input.membershipId,
        input.tenantId,
        tx,
      );
      if (membership === null) {
        return err(new NotFoundError("Membership not found"));
      }

      membership.changeRole(
        roleName.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.memberships.save(membership, tx);
      return ok({ membershipId: membership.id.toString(), roleName: roleName.value.value });
    });
  }
}
