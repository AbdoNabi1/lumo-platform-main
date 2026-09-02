import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Redirect } from "../domain/redirect";
import type { RedirectRepository } from "../domain/repositories";

export interface RedirectIdInput {
  readonly redirectId: string;
}

export interface GetRedirectDeps {
  readonly redirects: RedirectRepository;
}

/** Fetches a single redirect by id. */
export class GetRedirect implements UseCase<RedirectIdInput, Redirect, DomainError> {
  private readonly deps: GetRedirectDeps;

  constructor(deps: GetRedirectDeps) {
    this.deps = deps;
  }

  async execute(input: RedirectIdInput): Promise<Result<Redirect, DomainError>> {
    const redirect = await this.deps.redirects.findById(input.redirectId);
    return redirect === null ? err(new NotFoundError("Redirect not found")) : ok(redirect);
  }
}
