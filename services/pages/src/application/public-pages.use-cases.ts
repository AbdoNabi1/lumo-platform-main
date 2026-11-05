import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { pageNotFound } from "../domain/errors";
import type { Page } from "../domain/page";
import { pageHandleOf } from "../domain/page-content";
import type { PageRepository } from "../domain/repositories";

export interface PublicPagesDeps {
  readonly pages: PageRepository;
}

/** The most pages one published listing returns (Ruling 22). */
export const PUBLISHED_PAGES_MAX = 500;

export interface GetPublishedPageByPathInput {
  readonly routePath: string;
  readonly tenantId: string;
}

/** A published page at `/pages/<handle>`; a draft, archived or unknown page is `PAGE_NOT_FOUND`. */
export class GetPublishedPageByPath implements UseCase<
  GetPublishedPageByPathInput,
  Page,
  DomainError
> {
  private readonly deps: PublicPagesDeps;

  constructor(deps: PublicPagesDeps) {
    this.deps = deps;
  }

  async execute(input: GetPublishedPageByPathInput): Promise<Result<Page, DomainError>> {
    if (pageHandleOf(input.routePath) === null) return err(pageNotFound());
    const page = await this.deps.pages.findByRoutePath(input.routePath, input.tenantId);
    return page !== null && page.status === "published" ? ok(page) : err(pageNotFound());
  }
}

export interface ListPublishedPagesInput {
  readonly tenantId: string;
  readonly first?: number;
}

/** Published `/pages/<handle>` pages ordered by handle; `first` is clamped to 1-500. */
export class ListPublishedPages implements UseCase<
  ListPublishedPagesInput,
  readonly Page[],
  DomainError
> {
  private readonly deps: PublicPagesDeps;

  constructor(deps: PublicPagesDeps) {
    this.deps = deps;
  }

  async execute(input: ListPublishedPagesInput): Promise<Result<readonly Page[], DomainError>> {
    const requested = Number.isFinite(input.first) ? Math.trunc(input.first as number) : 500;
    const limit = Math.min(Math.max(requested, 1), PUBLISHED_PAGES_MAX);
    return ok(await this.deps.pages.listPublished(input.tenantId, limit));
  }
}

export interface GetPagesByIdsInput {
  readonly ids: readonly string[];
  readonly tenantId: string;
}

/** Pages by id for one shop; unknown ids are skipped. */
export class GetPagesByIds implements UseCase<GetPagesByIdsInput, readonly Page[], DomainError> {
  private readonly deps: PublicPagesDeps;

  constructor(deps: PublicPagesDeps) {
    this.deps = deps;
  }

  async execute(input: GetPagesByIdsInput): Promise<Result<readonly Page[], DomainError>> {
    return ok(await this.deps.pages.findByIds(input.ids, input.tenantId));
  }
}
