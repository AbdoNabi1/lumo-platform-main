import type { CursorPage } from "@platform/types";
import type { GetCurrentWorkspace } from "../application/get-current-workspace.use-case";
import type { GetTenant } from "../application/get-tenant.use-case";
import type { GetWorkspace } from "../application/get-workspace.use-case";
import type { ListTenants } from "../application/list-tenants.use-case";
import type { ListWorkspaces } from "../application/list-workspaces.use-case";
import type {
  ActivateTenant,
  ArchiveWorkspace,
  CancelTenant,
  ConfigureWorkspace,
  ConfigureWorkspaceInput,
  CreateTenant,
  CreateTenantInput,
  CreateWorkspace,
  CreateWorkspaceInput,
  RebrandTenant,
  RebrandTenantInput,
  SuspendTenant,
  TenantIdInput,
  WorkspaceIdInput,
} from "../application/tenancy.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface TenancyControllerDeps {
  readonly createTenant: CreateTenant;
  readonly activateTenant: ActivateTenant;
  readonly suspendTenant: SuspendTenant;
  readonly cancelTenant: CancelTenant;
  readonly rebrandTenant: RebrandTenant;
  readonly createWorkspace: CreateWorkspace;
  readonly archiveWorkspace: ArchiveWorkspace;
  readonly configureWorkspace: ConfigureWorkspace;
  readonly listTenants: ListTenants;
  readonly getTenant: GetTenant;
  readonly listWorkspaces: ListWorkspaces;
  readonly getWorkspace: GetWorkspace;
  readonly getCurrentWorkspace: GetCurrentWorkspace;
}

/** Framework-agnostic interface boundary for Tenancy use-cases (no HTTP server). */
export class TenancyController {
  private readonly deps: TenancyControllerDeps;

  constructor(deps: TenancyControllerDeps) {
    this.deps = deps;
  }

  async createTenant(input: CreateTenantInput): Promise<ControllerResponse> {
    return present(await this.deps.createTenant.execute(input), 201);
  }

  async activateTenant(input: TenantIdInput): Promise<ControllerResponse> {
    return present(await this.deps.activateTenant.execute(input), 200);
  }

  async suspendTenant(input: TenantIdInput): Promise<ControllerResponse> {
    return present(await this.deps.suspendTenant.execute(input), 200);
  }

  async cancelTenant(input: TenantIdInput): Promise<ControllerResponse> {
    return present(await this.deps.cancelTenant.execute(input), 200);
  }

  async rebrandTenant(input: RebrandTenantInput): Promise<ControllerResponse> {
    return present(await this.deps.rebrandTenant.execute(input), 200);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<ControllerResponse> {
    return present(await this.deps.createWorkspace.execute(input), 201);
  }

  async archiveWorkspace(input: WorkspaceIdInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveWorkspace.execute(input), 200);
  }

  async configureWorkspace(input: ConfigureWorkspaceInput): Promise<ControllerResponse> {
    return present(await this.deps.configureWorkspace.execute(input), 200);
  }

  async listTenants(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listTenants.execute(input), 200);
  }

  async getTenant(input: TenantIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getTenant.execute(input), 200);
  }

  async listWorkspaces(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listWorkspaces.execute(input), 200);
  }

  async getWorkspace(input: WorkspaceIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getWorkspace.execute(input), 200);
  }

  async getCurrentWorkspace(): Promise<ControllerResponse> {
    return present(await this.deps.getCurrentWorkspace.execute({}), 200);
  }
}
