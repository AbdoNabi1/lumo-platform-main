import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Page } from "../domain/page";
import type { PageRepository } from "../domain/repositories";

export interface ListPagesDeps {
  readonly pages: PageRepository;
}

/** Cursor-paginated page listing. */
export class ListPages implements UseCase<CursorPage, Paginated<Page>, DomainError> {
  private readonly deps: ListPagesDeps;

  constructor(deps: ListPagesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Page>, DomainError>> {
    return ok(await this.deps.pages.list(input));
  }
}
