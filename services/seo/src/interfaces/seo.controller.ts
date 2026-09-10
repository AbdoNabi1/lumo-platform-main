import type { GetRedirect, RedirectIdInput } from "../application/get-redirect.use-case";
import type { GetRobotsPolicy, PolicyIdInput } from "../application/get-robots-policy.use-case";
import type { GetSeoProfile, ProfileIdInput } from "../application/get-seo-profile.use-case";
import type { GetSitemap, SitemapIdInput } from "../application/get-sitemap.use-case";
import type { ListRedirects, ListRedirectsInput } from "../application/list-redirects.use-case";
import type {
  ListRobotsPolicies,
  ListRobotsPoliciesInput,
} from "../application/list-robots-policies.use-case";
import type {
  ListSeoProfiles,
  ListSeoProfilesInput,
} from "../application/list-seo-profiles.use-case";
import type { ListSitemaps, ListSitemapsInput } from "../application/list-sitemaps.use-case";
import type {
  CreateRedirect,
  CreateRedirectInput,
  CreateSitemap,
  CreateSitemapInput,
  RegenerateSitemap,
  RegenerateSitemapInput,
  SetRobotsPolicy,
  SetRobotsPolicyInput,
  SetSeoProfile,
  SetSeoProfileInput,
} from "../application/seo.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface SeoControllerDeps {
  readonly setSeoProfile: SetSeoProfile;
  readonly createRedirect: CreateRedirect;
  readonly createSitemap: CreateSitemap;
  readonly regenerateSitemap: RegenerateSitemap;
  readonly setRobotsPolicy: SetRobotsPolicy;
  readonly listSeoProfiles: ListSeoProfiles;
  readonly getSeoProfile: GetSeoProfile;
  readonly listRedirects: ListRedirects;
  readonly getRedirect: GetRedirect;
  readonly listSitemaps: ListSitemaps;
  readonly getSitemap: GetSitemap;
  readonly listRobotsPolicies: ListRobotsPolicies;
  readonly getRobotsPolicy: GetRobotsPolicy;
}

/** Framework-agnostic interface boundary for SEO use-cases (no HTTP server). */
export class SeoController {
  private readonly deps: SeoControllerDeps;

  constructor(deps: SeoControllerDeps) {
    this.deps = deps;
  }

  async setSeoProfile(input: SetSeoProfileInput): Promise<ControllerResponse> {
    return present(await this.deps.setSeoProfile.execute(input), 200);
  }

  async createRedirect(input: CreateRedirectInput): Promise<ControllerResponse> {
    return present(await this.deps.createRedirect.execute(input), 201);
  }

  async createSitemap(input: CreateSitemapInput): Promise<ControllerResponse> {
    return present(await this.deps.createSitemap.execute(input), 201);
  }

  async regenerateSitemap(input: RegenerateSitemapInput): Promise<ControllerResponse> {
    return present(await this.deps.regenerateSitemap.execute(input), 200);
  }

  async setRobotsPolicy(input: SetRobotsPolicyInput): Promise<ControllerResponse> {
    return present(await this.deps.setRobotsPolicy.execute(input), 200);
  }

  async listSeoProfiles(input: ListSeoProfilesInput): Promise<ControllerResponse> {
    return present(await this.deps.listSeoProfiles.execute(input), 200);
  }

  async getSeoProfile(input: ProfileIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getSeoProfile.execute(input), 200);
  }

  async listRedirects(input: ListRedirectsInput): Promise<ControllerResponse> {
    return present(await this.deps.listRedirects.execute(input), 200);
  }

  async getRedirect(input: RedirectIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getRedirect.execute(input), 200);
  }

  async listSitemaps(input: ListSitemapsInput): Promise<ControllerResponse> {
    return present(await this.deps.listSitemaps.execute(input), 200);
  }

  async getSitemap(input: SitemapIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getSitemap.execute(input), 200);
  }

  async listRobotsPolicies(input: ListRobotsPoliciesInput): Promise<ControllerResponse> {
    return present(await this.deps.listRobotsPolicies.execute(input), 200);
  }

  async getRobotsPolicy(input: PolicyIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getRobotsPolicy.execute(input), 200);
  }
}
