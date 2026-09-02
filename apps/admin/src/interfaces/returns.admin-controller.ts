import type { Principal } from "@platform/contracts";
import type { ReturnsController } from "@platform/returns";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ReturnsAdminControllerDeps {
  readonly returns: ReturnsController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Returns** admin screen to the Returns context (Sprint 4.11 — Returns' first admin
 * wiring). Pure delegation over the 8 backoffice-relevant actions (create/decision/rma/receive/
 * inspection/accept/transitions/resolution), per `SPRINT_4_11_RETURNS_CORE_REPORT.md` §2's "8
 * versioned zod routes". Every action authorizes the acting principal first (RBAC seam, ADR-0007;
 * permissive until real RBAC lands).
 */
export class ReturnsAdminController {
  private readonly returns: ReturnsController;
  private readonly guard: AdminGuard;

  constructor(deps: ReturnsAdminControllerDeps) {
    this.returns = deps.returns;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ReturnsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:create");
    if (denied) return denied;
    return this.returns.create(input);
  }

  async decision(
    principal: Principal,
    input: Parameters<ReturnsController["decision"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:decision");
    if (denied) return denied;
    return this.returns.decision(input);
  }

  async rma(
    principal: Principal,
    input: Parameters<ReturnsController["rma"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:rma");
    if (denied) return denied;
    return this.returns.rma(input);
  }

  async receive(
    principal: Principal,
    input: Parameters<ReturnsController["receive"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:receive");
    if (denied) return denied;
    return this.returns.receive(input);
  }

  async inspection(
    principal: Principal,
    input: Parameters<ReturnsController["inspection"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:inspection");
    if (denied) return denied;
    return this.returns.inspection(input);
  }

  async accept(
    principal: Principal,
    input: Parameters<ReturnsController["accept"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:accept");
    if (denied) return denied;
    return this.returns.accept(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ReturnsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:advance");
    if (denied) return denied;
    return this.returns.advance(input);
  }

  async getByOrder(
    principal: Principal,
    input: Parameters<ReturnsController["getByOrder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:read");
    if (denied) return denied;
    return this.returns.getByOrder(input);
  }

  async resolution(
    principal: Principal,
    input: Parameters<ReturnsController["resolution"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "returns:resolution");
    if (denied) return denied;
    return this.returns.resolution(input);
  }
}
