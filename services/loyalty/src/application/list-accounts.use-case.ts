import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";

export interface ListAccountsDeps {
  readonly accounts: LoyaltyAccountRepository;
}

/** Cursor-paginated loyalty-account listing. */
export class ListAccounts implements UseCase<CursorPage, Paginated<LoyaltyAccount>, DomainError> {
  private readonly deps: ListAccountsDeps;

  constructor(deps: ListAccountsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<LoyaltyAccount>, DomainError>> {
    return ok(await this.deps.accounts.list(input));
  }
}
