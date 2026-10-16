import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Page } from "../domain/page";
import type { PageRepository } from "../domain/repositories";
import type { PageIdInput } from "./pages.use-cases";

export interface GetPageDeps {
  readonly pages: PageRepository;
}

/** Fetches a single page by id. */
export class GetPage implements UseCase<PageIdInput, Page, DomainError> {
  private readonly deps: GetPageDeps;

  constructor(deps: GetPageDeps) {
    this.deps = deps;
  }

  async execute(input: PageIdInput): Promise<Result<Page, DomainError>> {
    const page = await this.deps.pages.findById(input.pageId, input.tenantId);
    return page === null ? err(new NotFoundError("Page not found")) : ok(page);
  }
}
