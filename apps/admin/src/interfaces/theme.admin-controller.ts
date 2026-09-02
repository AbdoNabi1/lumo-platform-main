import type { Principal } from "@platform/contracts";
import type { ThemeController } from "@platform/theme";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ThemeAdminControllerDeps {
  readonly theme: ThemeController;
  readonly guard: AdminGuard;
}

/** Wires the Theme System admin screen to the Theme context (Sprint 5.4). Pure delegation. */
export class ThemeAdminController {
  private readonly theme: ThemeController;
  private readonly guard: AdminGuard;

  constructor(deps: ThemeAdminControllerDeps) {
    this.theme = deps.theme;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ThemeController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "theme:create");
    if (denied) return denied;
    return this.theme.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ThemeController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "theme:advance");
    if (denied) return denied;
    return this.theme.advance(input);
  }

  async updateVariables(
    principal: Principal,
    input: Parameters<ThemeController["updateVariables"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "theme:update_variables");
    if (denied) return denied;
    return this.theme.updateVariables(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "theme:read");
    if (denied) return denied;
    return this.theme.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<ThemeController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "theme:read");
    if (denied) return denied;
    return this.theme.get(input);
  }
}
