import type { CursorPage } from "@platform/types";
import type { GetAccount } from "../application/get-account.use-case";
import type {
  GetAccountByCustomer,
  GetAccountByCustomerInput,
} from "../application/get-account-by-customer.use-case";
import type { ListAccounts } from "../application/list-accounts.use-case";
import type {
  AccountIdInput,
  AdvanceAccount,
  AdvanceAccountInput,
  CompleteReferral,
  CompleteReferralInput,
  EarnPoints,
  LedgerInput,
  OpenAccount,
  OpenAccountInput,
  RecordCashback,
  RedeemReward,
  RedeemRewardInput,
  SpendPoints,
} from "../application/loyalty.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface LoyaltyControllerDeps {
  readonly openAccount: OpenAccount;
  readonly advanceAccount: AdvanceAccount;
  readonly earnPoints: EarnPoints;
  readonly spendPoints: SpendPoints;
  readonly recordCashback: RecordCashback;
  readonly redeemReward: RedeemReward;
  readonly completeReferral: CompleteReferral;
  readonly listAccounts: ListAccounts;
  readonly getAccount: GetAccount;
  readonly getAccountByCustomer: GetAccountByCustomer;
}

/** Framework-agnostic interface boundary for loyalty use-cases (no HTTP server). */
export class LoyaltyController {
  private readonly deps: LoyaltyControllerDeps;

  constructor(deps: LoyaltyControllerDeps) {
    this.deps = deps;
  }

  async open(input: OpenAccountInput): Promise<ControllerResponse> {
    return present(await this.deps.openAccount.execute(input), 201);
  }

  async advance(input: AdvanceAccountInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceAccount.execute(input), 200);
  }

  async earn(input: LedgerInput): Promise<ControllerResponse> {
    return present(await this.deps.earnPoints.execute(input), 200);
  }

  async spend(input: LedgerInput): Promise<ControllerResponse> {
    return present(await this.deps.spendPoints.execute(input), 200);
  }

  async cashback(input: LedgerInput): Promise<ControllerResponse> {
    return present(await this.deps.recordCashback.execute(input), 200);
  }

  async redeem(input: RedeemRewardInput): Promise<ControllerResponse> {
    return present(await this.deps.redeemReward.execute(input), 200);
  }

  async referral(input: CompleteReferralInput): Promise<ControllerResponse> {
    return present(await this.deps.completeReferral.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listAccounts.execute(input), 200);
  }

  async get(input: AccountIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getAccount.execute(input), 200);
  }

  /** The one loyalty account a customer owns, resolved by `customerRef` rather than `accountId` — see `GetAccountByCustomer`. */
  async getByCustomer(input: GetAccountByCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.getAccountByCustomer.execute(input), 200);
  }
}
