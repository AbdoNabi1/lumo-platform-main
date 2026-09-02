import type { Principal } from "@platform/contracts";
import type { AccessController } from "@platform/identity";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface AccessAdminControllerDeps {
  readonly access: AccessController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Users/Organizations/Memberships** admin screens to Identity's Access slice
 * (Sprint 4.1, Option A). Pure delegation. Every action authorizes the acting principal first
 * (RBAC seam, ADR-0007; permissive until real RBAC lands) — this facade never evaluates roles or
 * permissions itself, that stays Keto's.
 */
export class AccessAdminController {
  private readonly access: AccessController;
  private readonly guard: AdminGuard;

  constructor(deps: AccessAdminControllerDeps) {
    this.access = deps.access;
    this.guard = deps.guard;
  }

  async createUser(
    principal: Principal,
    input: Parameters<AccessController["createUser"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "users:create");
    if (denied) return denied;
    return this.access.createUser(input);
  }

  async renameUser(
    principal: Principal,
    input: Parameters<AccessController["renameUser"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "users:rename");
    if (denied) return denied;
    return this.access.renameUser(input);
  }

  async deactivateUser(
    principal: Principal,
    input: Parameters<AccessController["deactivateUser"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "users:deactivate");
    if (denied) return denied;
    return this.access.deactivateUser(input);
  }

  async createOrganization(
    principal: Principal,
    input: Parameters<AccessController["createOrganization"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "organizations:create");
    if (denied) return denied;
    return this.access.createOrganization(input);
  }

  async archiveOrganization(
    principal: Principal,
    input: Parameters<AccessController["archiveOrganization"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "organizations:archive");
    if (denied) return denied;
    return this.access.archiveOrganization(input);
  }

  async addMembership(
    principal: Principal,
    input: Parameters<AccessController["addMembership"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "memberships:add");
    if (denied) return denied;
    return this.access.addMembership(input);
  }

  async changeMembershipRole(
    principal: Principal,
    input: Parameters<AccessController["changeMembershipRole"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "memberships:change_role");
    if (denied) return denied;
    return this.access.changeMembershipRole(input);
  }
}
