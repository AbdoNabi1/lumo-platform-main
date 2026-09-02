import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";

export interface GetAccountByCustomerInput {
  readonly customerRef: string;
}

export interface GetAccountByCustomerDeps {
  readonly accounts: LoyaltyAccountRepository;
}

/**
 * Fetches the one loyalty account a customer owns, by `customerRef` rather than `accountId`. The
 * customer-facing public surface (T5.19, `apps/admin/src/http/public-loyalty-routes.ts`) has no
 * `accountId` to address with — a customer's session yields a `customerRef`, never an account id —
 * so this mirrors Wishlist's `GetWishlistByCustomer` in shape: a `NotFoundError` here means "this
 * customer has no loyalty account yet", which is a real, honest state (accounts are opened by an
 * admin/system action, e.g. first purchase, never self-service), not an error to paper over with a
 * fabricated zero-balance account.
 */
export class GetAccountByCustomer
  implements UseCase<GetAccountByCustomerInput, LoyaltyAccount, DomainError>
{
  private readonly deps: GetAccountByCustomerDeps;

  constructor(deps: GetAccountByCustomerDeps) {
    this.deps = deps;
  }

  async execute(input: GetAccountByCustomerInput): Promise<Result<LoyaltyAccount, DomainError>> {
    const account = await this.deps.accounts.findByCustomerRef(input.customerRef);
    return account === null ? err(new NotFoundError("Loyalty account not found")) : ok(account);
  }
}
