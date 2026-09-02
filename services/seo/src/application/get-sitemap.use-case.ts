import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { SitemapRepository } from "../domain/repositories";
import type { Sitemap } from "../domain/sitemap";
import type { RegenerateSitemapInput } from "./seo.use-cases";

export type SitemapIdInput = Pick<RegenerateSitemapInput, "sitemapId">;

export interface GetSitemapDeps {
  readonly sitemaps: SitemapRepository;
}

/** Fetches a single sitemap by id. */
export class GetSitemap implements UseCase<SitemapIdInput, Sitemap, DomainError> {
  private readonly deps: GetSitemapDeps;

  constructor(deps: GetSitemapDeps) {
    this.deps = deps;
  }

  async execute(input: SitemapIdInput): Promise<Result<Sitemap, DomainError>> {
    const sitemap = await this.deps.sitemaps.findById(input.sitemapId);
    return sitemap === null ? err(new NotFoundError("Sitemap not found")) : ok(sitemap);
  }
}
