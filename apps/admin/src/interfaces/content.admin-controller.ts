import type { Principal } from "@platform/contracts";
import type { ContentController } from "@platform/content";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface ContentAdminControllerDeps {
  readonly content: ContentController;
  readonly guard: AdminGuard;
}

/** Wires the Content Blocks admin screen to the Content context (Sprint 5.4). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class ContentAdminController {
  private readonly content: ContentController;
  private readonly guard: AdminGuard;

  constructor(deps: ContentAdminControllerDeps) {
    this.content = deps.content;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<ContentController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "content:create");
    if (denied) return denied;
    return this.content.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<ContentController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "content:advance");
    if (denied) return denied;
    return this.content.advance(input);
  }

  async updateBody(
    principal: Principal,
    input: Parameters<ContentController["updateBody"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "content:update");
    if (denied) return denied;
    return this.content.updateBody(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "content:read");
    if (denied) return denied;
    return this.content.list(input);
  }
}
