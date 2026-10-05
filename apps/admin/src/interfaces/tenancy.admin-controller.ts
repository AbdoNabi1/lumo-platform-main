import type { Principal } from "@platform/contracts";
import type { TenancyController } from "@platform/tenancy";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface TenancyAdminControllerDeps {
  readonly tenancy: TenancyController;
  readonly guard: AdminGuard;
}

/** Wires the Tenancy admin screen to the Tenancy context (Sprint 5.5/5.6). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class TenancyAdminController {
  private readonly tenancy: TenancyController;
  private readonly guard: AdminGuard;

  constructor(deps: TenancyAdminControllerDeps) {
    this.tenancy = deps.tenancy;
    this.guard = deps.guard;
  }

  async createTenant(
    principal: Principal,
    input: Parameters<TenancyController["createTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:create");
    if (denied) return denied;
    return this.tenancy.createTenant(input);
  }

  async activateTenant(
    principal: Principal,
    input: Parameters<TenancyController["activateTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.activateTenant(input);
  }

  async suspendTenant(
    principal: Principal,
    input: Parameters<TenancyController["suspendTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.suspendTenant(input);
  }

  async cancelTenant(
    principal: Principal,
    input: Parameters<TenancyController["cancelTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.cancelTenant(input);
  }

  async rebrandTenant(
    principal: Principal,
    input: Parameters<TenancyController["rebrandTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.rebrandTenant(input);
  }

  async createWorkspace(
    principal: Principal,
    input: Parameters<TenancyController["createWorkspace"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:create");
    if (denied) return denied;
    return this.tenancy.createWorkspace(input);
  }

  async archiveWorkspace(
    principal: Principal,
    input: Parameters<TenancyController["archiveWorkspace"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.archiveWorkspace(input);
  }

  async configureWorkspace(
    principal: Principal,
    input: Parameters<TenancyController["configureWorkspace"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.configureWorkspace(input);
  }

  async listTenants(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.listTenants(input);
  }

  async getTenant(
    principal: Principal,
    input: Parameters<TenancyController["getTenant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.getTenant(input);
  }

  async listWorkspaces(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.listWorkspaces(input);
  }

  async getWorkspace(
    principal: Principal,
    input: Parameters<TenancyController["getWorkspace"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.getWorkspace(input);
  }

  async listShopDomains(
    principal: Principal,
    input: Parameters<TenancyController["listShopDomains"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.listShopDomains(input);
  }

  async addCustomDomain(
    principal: Principal,
    input: Parameters<TenancyController["addCustomDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.addCustomDomain(input);
  }

  async verifyDomain(
    principal: Principal,
    input: Parameters<TenancyController["verifyDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.verifyDomain(input);
  }

  async setPrimaryDomain(
    principal: Principal,
    input: Parameters<TenancyController["setPrimaryDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.setPrimaryDomain(input);
  }

  /**
   * Plan 1A: UNGUARDED on purpose — the storefront edge resolves a hostname before anyone is signed
   * in (same reasoning as `admin.publicReads`). Returns only shop id, hostnames and shop status.
   */
  async resolveHost(
    input: Parameters<TenancyController["resolveHost"]>[0],
  ): Promise<AdminResponse> {
    return this.tenancy.resolveHost(input);
  }

  async getCurrentWorkspace(principal: Principal): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.getCurrentWorkspace();
  }
}
