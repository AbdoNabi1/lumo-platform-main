import type { Principal } from "@platform/contracts";
import type { ExperimentationController } from "@platform/experimentation";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ExperimentationAdminControllerDeps {
  readonly experimentation: ExperimentationController;
  readonly guard: AdminGuard;
}

/** Wires the Experimentation admin screen to the Experimentation context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class ExperimentationAdminController {
  private readonly experimentation: ExperimentationController;
  private readonly guard: AdminGuard;

  constructor(deps: ExperimentationAdminControllerDeps) {
    this.experimentation = deps.experimentation;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ExperimentationController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:create");
    if (denied) return denied;
    return this.experimentation.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ExperimentationController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:advance");
    if (denied) return denied;
    return this.experimentation.advance(input);
  }

  async recordResult(
    principal: Principal,
    input: Parameters<ExperimentationController["recordResult"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:record_result");
    if (denied) return denied;
    return this.experimentation.recordResult(input);
  }

  async declareWinner(
    principal: Principal,
    input: Parameters<ExperimentationController["declareWinner"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:declare_winner");
    if (denied) return denied;
    return this.experimentation.declareWinner(input);
  }

  async list(
    principal: Principal,
    input: Parameters<ExperimentationController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:read");
    if (denied) return denied;
    return this.experimentation.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<ExperimentationController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experiments:read");
    if (denied) return denied;
    return this.experimentation.get(input);
  }
}
