import type { Principal } from "@platform/contracts";
import type { SeoController } from "@platform/seo";
import type { CursorPage } from "@platform/types";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface SeoAdminControllerDeps {
  readonly seo: SeoController;
  readonly guard: AdminGuard;
}

/** Wires the SEO admin screen to the SEO context (Sprint 5.4). Pure delegation. */
export class SeoAdminController {
  private readonly seo: SeoController;
  private readonly guard: AdminGuard;

  constructor(deps: SeoAdminControllerDeps) {
    this.seo = deps.seo;
    this.guard = deps.guard;
  }

  async setSeoProfile(
    principal: Principal,
    input: Parameters<SeoController["setSeoProfile"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:set_profile");
    if (denied) return denied;
    return this.seo.setSeoProfile(input);
  }

  async createRedirect(
    principal: Principal,
    input: Parameters<SeoController["createRedirect"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:create_redirect");
    if (denied) return denied;
    return this.seo.createRedirect(input);
  }

  async createSitemap(
    principal: Principal,
    input: Parameters<SeoController["createSitemap"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:create_sitemap");
    if (denied) return denied;
    return this.seo.createSitemap(input);
  }

  async regenerateSitemap(
    principal: Principal,
    input: Parameters<SeoController["regenerateSitemap"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:regenerate_sitemap");
    if (denied) return denied;
    return this.seo.regenerateSitemap(input);
  }

  async setRobotsPolicy(
    principal: Principal,
    input: Parameters<SeoController["setRobotsPolicy"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:set_robots_policy");
    if (denied) return denied;
    return this.seo.setRobotsPolicy(input);
  }

  async listSeoProfiles(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.listSeoProfiles(input);
  }

  async getSeoProfile(
    principal: Principal,
    input: Parameters<SeoController["getSeoProfile"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.getSeoProfile(input);
  }

  async listRedirects(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.listRedirects(input);
  }

  async getRedirect(
    principal: Principal,
    input: Parameters<SeoController["getRedirect"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.getRedirect(input);
  }

  async listSitemaps(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.listSitemaps(input);
  }

  async getSitemap(
    principal: Principal,
    input: Parameters<SeoController["getSitemap"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.getSitemap(input);
  }

  async listRobotsPolicies(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.listRobotsPolicies(input);
  }

  async getRobotsPolicy(
    principal: Principal,
    input: Parameters<SeoController["getRobotsPolicy"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "seo:read");
    if (denied) return denied;
    return this.seo.getRobotsPolicy(input);
  }
}
