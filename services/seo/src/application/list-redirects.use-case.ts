import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Redirect } from "../domain/redirect";
import type { RedirectRepository } from "../domain/repositories";

export interface ListRedirectsDeps {
  readonly redirects: RedirectRepository;
}

/** Cursor-paginated redirect listing. */
export class ListRedirects implements UseCase<CursorPage, Paginated<Redirect>, DomainError> {
  private readonly deps: ListRedirectsDeps;

  constructor(deps: ListRedirectsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Redirect>, DomainError>> {
    return ok(await this.deps.redirects.list(input));
  }
}
