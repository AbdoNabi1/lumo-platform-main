import type { CursorPage, Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { GetCurrentWorkspace } from "../application/get-current-workspace.use-case";
import type { GetTenant } from "../application/get-tenant.use-case";
import type { GetWorkspace } from "../application/get-workspace.use-case";
import type { ListTenants } from "../application/list-tenants.use-case";
import type { ListWorkspaces } from "../application/list-workspaces.use-case";
import type {
  GetPublicStore,
  DismissSetupGuide,
  GetStoreSettings,
  UpdateStoreSettings,
} from "../application/store-settings.use-cases";
import type {
  ActivateDirectoryEntry,
  FindStaffDirectoryEntry,
  RecordPendingOwner,
} from "../application/staff-directory.use-cases";
import type { StaffDirectoryEntryInput, StaffDirectoryEntryView } from "../domain/staff-directory";
import type { StoreSettingsInput } from "../domain/store-settings";
import type {
  AddCustomDomain,
  AddCustomDomainInput,
  DomainIdInput,
  ListShopDomains,
  ResolveHost,
  ResolveHostInput,
  SetPrimaryDomain,
  ShopIdInput,
  VerifyDomain,
} from "../application/shop-domains.use-cases";
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
  readonly addCustomDomain: AddCustomDomain;
  readonly verifyDomain: VerifyDomain;
  readonly setPrimaryDomain: SetPrimaryDomain;
  readonly listShopDomains: ListShopDomains;
  readonly resolveHost: ResolveHost;
  readonly getStoreSettings: GetStoreSettings;
  readonly updateStoreSettings: UpdateStoreSettings;
  readonly dismissSetupGuide: DismissSetupGuide;
  readonly getPublicStore: GetPublicStore;
  readonly recordPendingOwner: RecordPendingOwner;
  readonly activateDirectoryEntry: ActivateDirectoryEntry;
  readonly findStaffDirectoryEntry: FindStaffDirectoryEntry;
  readonly slugTaken: (slug: string) => Promise<boolean>;
}

/** Framework-agnostic interface boundary for Tenancy use-cases (no HTTP server). */
export class TenancyController {
  private readonly deps: TenancyControllerDeps;

  constructor(deps: TenancyControllerDeps) {
    this.deps = deps;
  }

  async addCustomDomain(input: AddCustomDomainInput): Promise<ControllerResponse> {
    return present(await this.deps.addCustomDomain.execute(input), 201);
  }

  async verifyDomain(input: DomainIdInput): Promise<ControllerResponse> {
    return present(await this.deps.verifyDomain.execute(input), 200);
  }

  async setPrimaryDomain(input: DomainIdInput): Promise<ControllerResponse> {
    return present(await this.deps.setPrimaryDomain.execute(input), 200);
  }

  async listShopDomains(input: ShopIdInput): Promise<ControllerResponse> {
    return present(await this.deps.listShopDomains.execute(input), 200);
  }

  async getStoreSettings(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.getStoreSettings.execute({ tenantId }), 200);
  }

  async updateStoreSettings(
    tenantId: string,
    input: StoreSettingsInput,
  ): Promise<ControllerResponse> {
    return present(await this.deps.updateStoreSettings.execute({ tenantId, ...input }), 200);
  }

  async dismissSetupGuide(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.dismissSetupGuide.execute({ tenantId }), 200);
  }

  async getPublicStore(tenantId: string): Promise<ControllerResponse> {
    return present(await this.deps.getPublicStore.execute({ tenantId }), 200);
  }

  /**
   * Staff directory (email -> store). Raw and unguarded on purpose: these return plain values and
   * `Result`s, not `ControllerResponse`, and are only called by `apps/admin` services, never over HTTP.
   */
  async findStaffDirectoryEntry(email: string): Promise<StaffDirectoryEntryView | null> {
    return this.deps.findStaffDirectoryEntry.execute(email);
  }

  /** Whether a tenant already holds `slug` (sign-up picks a free one). Raw, like the directory reads. */
  async slugTaken(slug: string): Promise<boolean> {
    return this.deps.slugTaken(slug);
  }

  async recordPendingOwner(
    input: StaffDirectoryEntryInput,
  ): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    return this.deps.recordPendingOwner.execute(input);
  }

  async activateDirectoryEntry(
    email: string,
  ): Promise<Result<StaffDirectoryEntryView, DomainError>> {
    return this.deps.activateDirectoryEntry.execute({ email });
  }

  async resolveHost(input: ResolveHostInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveHost.execute(input), 200);
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
