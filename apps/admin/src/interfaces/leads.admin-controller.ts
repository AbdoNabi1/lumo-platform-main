import type { Permission, Principal } from "@platform/contracts";
import type { LeadsController } from "@platform/leads";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface LeadsAdminControllerDeps {
  readonly leads: LeadsController;
  readonly guard: AdminGuard;
}

type In<K extends "list" | "get" | "changeStatus" | "exportRows"> = Parameters<
  LeadsController[K]
>[0];

/**
 * The Leads inbox screens → Leads (Lead Site Part C). Each action authorizes, then delegates. The
 * visitor's own submission is NOT here: an anonymous visitor holds no staff `Principal`, so
 * `public-leads-routes.ts` calls the raw controller through `publicReads.leads`.
 */
export class LeadsAdminController {
  private readonly leads: LeadsController;
  private readonly guard: AdminGuard;

  constructor(deps: LeadsAdminControllerDeps) {
    this.leads = deps.leads;
    this.guard = deps.guard;
  }

  private async run(
    principal: Principal,
    permission: Permission,
    action: () => Promise<AdminResponse>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, permission);
    return denied ?? action();
  }

  list(p: Principal, input: In<"list">): Promise<AdminResponse> {
    return this.run(p, "leads:read", () => this.leads.list(input));
  }
  get(p: Principal, input: In<"get">): Promise<AdminResponse> {
    return this.run(p, "leads:read", () => this.leads.get(input));
  }
  changeStatus(p: Principal, input: In<"changeStatus">): Promise<AdminResponse> {
    return this.run(p, "leads:update", () => this.leads.changeStatus(input));
  }
  exportRows(p: Principal, input: In<"exportRows">): Promise<AdminResponse> {
    return this.run(p, "leads:export", () => this.leads.exportRows(input));
  }
}
