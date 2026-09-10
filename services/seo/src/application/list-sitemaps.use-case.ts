import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SitemapRepository } from "../domain/repositories";
import type { Sitemap } from "../domain/sitemap";

export interface ListSitemapsInput extends CursorPage {
  readonly tenantId: string;
}

export interface ListSitemapsDeps {
  readonly sitemaps: SitemapRepository;
}

/** Cursor-paginated sitemap listing. */
export class ListSitemaps implements UseCase<ListSitemapsInput, Paginated<Sitemap>, DomainError> {
  private readonly deps: ListSitemapsDeps;

  constructor(deps: ListSitemapsDeps) {
    this.deps = deps;
  }

  async execute(input: ListSitemapsInput): Promise<Result<Paginated<Sitemap>, DomainError>> {
    return ok(await this.deps.sitemaps.list(input, input.tenantId));
  }
}
