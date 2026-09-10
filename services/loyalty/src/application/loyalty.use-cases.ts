import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { LoyaltyAccount } from "../domain/loyalty-account";
import type { LoyaltyAccountRepository } from "../domain/loyalty-account-repository";
import type { AccountStatusValue } from "../domain/value-objects/account-status";
import type { RewardTier } from "../domain/value-objects/reward-tier";
import { Reward } from "../domain/value-objects/reward";

export interface OpenAccountInput {
  readonly customerRef: string;
  readonly tenantId: string;
}

export interface AccountStatusOutput {
  readonly accountId: string;
  readonly status: string;
  readonly balance: number;
  readonly tierName: string;
}

export interface AccountIdInput {
  readonly accountId: string;
  readonly tenantId: string;
}

export interface AdvanceAccountInput extends AccountIdInput {
  readonly toStatus: AccountStatusValue;
}

export interface LoyaltyDeps {
  readonly accounts: LoyaltyAccountRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly tiers: readonly RewardTier[];
}

function toOutput(account: LoyaltyAccount): AccountStatusOutput {
  return {
    accountId: account.id.toString(),
    status: account.status.value,
    balance: account.points.balance,
    tierName: account.tierName,
  };
}

/** Opens a loyalty account for a customer — one account per customer. */
export class OpenAccount implements UseCase<OpenAccountInput, AccountStatusOutput, DomainError> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: OpenAccountInput): Promise<Result<AccountStatusOutput, DomainError>> {
    const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
    if (!customerRef.ok) return err(customerRef.error);

    return this.deps.unitOfWork.run<Result<AccountStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.accounts.findByCustomerRef(
        input.customerRef,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(
          new ConflictError(`Customer "${input.customerRef}" already has a loyalty account`),
        );
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const account = LoyaltyAccount.create(id, input.customerRef, this.deps.tiers);
      await this.deps.accounts.save(account, tx);
      return ok(toOutput(account));
    });
  }
}

/** Generic validated status transition — used for suspend/reactivate/close. */
export class AdvanceAccount implements UseCase<
  AdvanceAccountInput,
  AccountStatusOutput,
  DomainError
> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceAccountInput): Promise<Result<AccountStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<AccountStatusOutput, DomainError>>(async (tx) => {
      const account = await this.deps.accounts.findById(input.accountId, input.tenantId, tx);
      if (account === null) return err(new NotFoundError("Loyalty account not found"));

      try {
        account.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.accounts.save(account, tx);
      return ok(toOutput(account));
    });
  }
}

export interface LedgerInput extends AccountIdInput {
  readonly idempotencyKey: string;
  readonly points: number;
  readonly ref: string;
}

/** Earns points (idempotent by `idempotencyKey`). */
export class EarnPoints implements UseCase<LedgerInput, AccountStatusOutput, DomainError> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: LedgerInput): Promise<Result<AccountStatusOutput, DomainError>> {
    return runLedgerAction(this.deps, input, (account, occurredAt, eventId) =>
      account.earn(input.idempotencyKey, input.points, input.ref, eventId, occurredAt),
    );
  }
}

/** Spends points (idempotent by `idempotencyKey`). */
export class SpendPoints implements UseCase<LedgerInput, AccountStatusOutput, DomainError> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: LedgerInput): Promise<Result<AccountStatusOutput, DomainError>> {
    return runLedgerAction(this.deps, input, (account, occurredAt, eventId) =>
      account.spend(input.idempotencyKey, input.points, input.ref, eventId, occurredAt),
    );
  }
}

/** Records a cashback earning (idempotent by `idempotencyKey`). */
export class RecordCashback implements UseCase<LedgerInput, AccountStatusOutput, DomainError> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: LedgerInput): Promise<Result<AccountStatusOutput, DomainError>> {
    return runLedgerAction(this.deps, input, (account, occurredAt, eventId) =>
      account.recordCashback(input.idempotencyKey, input.points, input.ref, eventId, occurredAt),
    );
  }
}

export interface RedeemRewardInput extends AccountIdInput {
  readonly idempotencyKey: string;
  readonly rewardRef: string;
  readonly rewardName: string;
  readonly costPoints: number;
}

/** Redeems a catalog reward for points (idempotent by `idempotencyKey`). */
export class RedeemReward implements UseCase<RedeemRewardInput, AccountStatusOutput, DomainError> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: RedeemRewardInput): Promise<Result<AccountStatusOutput, DomainError>> {
    const reward = Reward.create(input.rewardRef, input.rewardName, input.costPoints);
    if (!reward.ok) return err(reward.error);

    return this.deps.unitOfWork.run<Result<AccountStatusOutput, DomainError>>(async (tx) => {
      const account = await this.deps.accounts.findById(input.accountId, input.tenantId, tx);
      if (account === null) return err(new NotFoundError("Loyalty account not found"));

      try {
        account.redeemReward(
          input.idempotencyKey,
          reward.value,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.accounts.save(account, tx);
      return ok(toOutput(account));
    });
  }
}

export interface CompleteReferralInput extends AccountIdInput {
  readonly idempotencyKey: string;
  readonly bonusPoints: number;
  readonly referredCustomerRef: string;
}

/** Completes a referral bonus (idempotent by `idempotencyKey`). */
export class CompleteReferral implements UseCase<
  CompleteReferralInput,
  AccountStatusOutput,
  DomainError
> {
  private readonly deps: LoyaltyDeps;

  constructor(deps: LoyaltyDeps) {
    this.deps = deps;
  }

  async execute(input: CompleteReferralInput): Promise<Result<AccountStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<AccountStatusOutput, DomainError>>(async (tx) => {
      const account = await this.deps.accounts.findById(input.accountId, input.tenantId, tx);
      if (account === null) return err(new NotFoundError("Loyalty account not found"));

      try {
        account.completeReferral(
          input.idempotencyKey,
          input.bonusPoints,
          input.referredCustomerRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.accounts.save(account, tx);
      return ok(toOutput(account));
    });
  }
}

async function runLedgerAction(
  deps: LoyaltyDeps,
  input: LedgerInput,
  action: (account: LoyaltyAccount, occurredAt: Date, eventId: string) => void,
): Promise<Result<AccountStatusOutput, DomainError>> {
  return deps.unitOfWork.run<Result<AccountStatusOutput, DomainError>>(async (tx) => {
    const account = await deps.accounts.findById(input.accountId, input.tenantId, tx);
    if (account === null) return err(new NotFoundError("Loyalty account not found"));

    try {
      action(account, deps.clock.now(), deps.idGenerator.generate());
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    await deps.accounts.save(account, tx);
    return ok(toOutput(account));
  });
}
