import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";
import type { AccountIdInput } from "./loyalty.use-cases";

export interface GetAccountDeps {
  readonly accounts: LoyaltyAccountRepository;
}

/** Fetches a single loyalty account by id — the balance is the whole point of this read. */
export class GetAccount implements UseCase<AccountIdInput, LoyaltyAccount, DomainError> {
  private readonly deps: GetAccountDeps;

  constructor(deps: GetAccountDeps) {
    this.deps = deps;
  }

  async execute(input: AccountIdInput): Promise<Result<LoyaltyAccount, DomainError>> {
    const account = await this.deps.accounts.findById(input.accountId, input.tenantId);
    return account === null ? err(new NotFoundError("Loyalty account not found")) : ok(account);
  }
}
