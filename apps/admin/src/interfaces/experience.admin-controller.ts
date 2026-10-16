import type { Principal } from "@platform/contracts";
import type { ExperienceController } from "@platform/experience";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ExperienceAdminControllerDeps {
  readonly experience: ExperienceController;
  readonly guard: AdminGuard;
}

/** Wires the Experience Builder admin screen to the Experience context (Sprint 5.4). Pure delegation. */
export class ExperienceAdminController {
  private readonly experience: ExperienceController;
  private readonly guard: AdminGuard;

  constructor(deps: ExperienceAdminControllerDeps) {
    this.experience = deps.experience;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ExperienceController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experience:create");
    if (denied) return denied;
    return this.experience.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ExperienceController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experience:advance");
    if (denied) return denied;
    return this.experience.advance(input);
  }

  async updateCanvas(
    principal: Principal,
    input: Parameters<ExperienceController["updateCanvas"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experience:update_canvas");
    if (denied) return denied;
    return this.experience.updateCanvas(input);
  }

  async list(
    principal: Principal,
    input: Parameters<ExperienceController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experience:read");
    if (denied) return denied;
    return this.experience.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<ExperienceController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "experience:read");
    if (denied) return denied;
    return this.experience.get(input);
  }
}
