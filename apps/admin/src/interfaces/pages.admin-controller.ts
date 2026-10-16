import type { Principal } from "@platform/contracts";
import type { PagesController } from "@platform/pages";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface PagesAdminControllerDeps {
  readonly pages: PagesController;
  readonly guard: AdminGuard;
}

/** Wires the Dynamic Pages admin screen to the Pages context (Sprint 5.4). Pure delegation. */
export class PagesAdminController {
  private readonly pages: PagesController;
  private readonly guard: AdminGuard;

  constructor(deps: PagesAdminControllerDeps) {
    this.pages = deps.pages;
    this.guard = deps.guard;
  }

  async createPage(
    principal: Principal,
    input: Parameters<PagesController["createPage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:create_page");
    if (denied) return denied;
    return this.pages.createPage(input);
  }

  async advancePage(
    principal: Principal,
    input: Parameters<PagesController["advancePage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:advance_page");
    if (denied) return denied;
    return this.pages.advancePage(input);
  }

  async createTemplate(
    principal: Principal,
    input: Parameters<PagesController["createTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:create_template");
    if (denied) return denied;
    return this.pages.createTemplate(input);
  }

  async archiveTemplate(
    principal: Principal,
    input: Parameters<PagesController["archiveTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:archive_template");
    if (denied) return denied;
    return this.pages.archiveTemplate(input);
  }

  async listPages(
    principal: Principal,
    input: Parameters<PagesController["listPages"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:read");
    if (denied) return denied;
    return this.pages.listPages(input);
  }

  async getPage(
    principal: Principal,
    input: Parameters<PagesController["getPage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:read");
    if (denied) return denied;
    return this.pages.getPage(input);
  }

  async listTemplates(
    principal: Principal,
    input: Parameters<PagesController["listTemplates"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:read");
    if (denied) return denied;
    return this.pages.listTemplates(input);
  }

  async getTemplate(
    principal: Principal,
    input: Parameters<PagesController["getTemplate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "pages:read");
    if (denied) return denied;
    return this.pages.getTemplate(input);
  }
}
