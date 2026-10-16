import type { Principal } from "@platform/contracts";
import type { ComponentsController } from "@platform/components";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ComponentsAdminControllerDeps {
  readonly components: ComponentsController;
  readonly guard: AdminGuard;
}

/** Wires the Component Library admin screen to the Components context (Sprint 5.4). Pure delegation. */
export class ComponentsAdminController {
  private readonly components: ComponentsController;
  private readonly guard: AdminGuard;

  constructor(deps: ComponentsAdminControllerDeps) {
    this.components = deps.components;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ComponentsController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "components:create");
    if (denied) return denied;
    return this.components.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ComponentsController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "components:advance");
    if (denied) return denied;
    return this.components.advance(input);
  }

  async list(
    principal: Principal,
    input: Parameters<ComponentsController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "components:read");
    if (denied) return denied;
    return this.components.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<ComponentsController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "components:read");
    if (denied) return denied;
    return this.components.get(input);
  }
}
