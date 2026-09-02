import type {
  ArchiveOrganization,
  ArchiveOrganizationInput,
  CreateOrganization,
  CreateOrganizationInput,
} from "../application/organization.use-cases";
import type {
  AddMembership,
  AddMembershipInput,
  ChangeMembershipRole,
  ChangeMembershipRoleInput,
} from "../application/membership.use-cases";
import type {
  CreateUser,
  CreateUserInput,
  DeactivateUser,
  DeactivateUserInput,
  RenameUser,
  RenameUserInput,
} from "../application/user.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface AccessControllerDeps {
  readonly createUser: CreateUser;
  readonly renameUser: RenameUser;
  readonly deactivateUser: DeactivateUser;
  readonly createOrganization: CreateOrganization;
  readonly archiveOrganization: ArchiveOrganization;
  readonly addMembership: AddMembership;
  readonly changeMembershipRole: ChangeMembershipRole;
}

/** Framework-agnostic interface boundary for User/Organization/Membership use-cases (no HTTP server). */
export class AccessController {
  private readonly deps: AccessControllerDeps;

  constructor(deps: AccessControllerDeps) {
    this.deps = deps;
  }

  async createUser(input: CreateUserInput): Promise<ControllerResponse> {
    return present(await this.deps.createUser.execute(input), 201);
  }

  async renameUser(input: RenameUserInput): Promise<ControllerResponse> {
    return present(await this.deps.renameUser.execute(input), 200);
  }

  async deactivateUser(input: DeactivateUserInput): Promise<ControllerResponse> {
    return present(await this.deps.deactivateUser.execute(input), 200);
  }

  async createOrganization(input: CreateOrganizationInput): Promise<ControllerResponse> {
    return present(await this.deps.createOrganization.execute(input), 201);
  }

  async archiveOrganization(input: ArchiveOrganizationInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveOrganization.execute(input), 200);
  }

  async addMembership(input: AddMembershipInput): Promise<ControllerResponse> {
    return present(await this.deps.addMembership.execute(input), 201);
  }

  async changeMembershipRole(input: ChangeMembershipRoleInput): Promise<ControllerResponse> {
    return present(await this.deps.changeMembershipRole.execute(input), 200);
  }
}
