import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { LoyaltyTransitioned } from "./events/loyalty-transitioned.event";
import { LoyaltyTransaction } from "./loyalty-transaction";
import {
  AccountStatus,
  canTransitionAccount,
  type AccountStatusValue,
} from "./value-objects/account-status";
import { LoyaltyPoint } from "./value-objects/loyalty-point";
import { resolveTier, type RewardTier } from "./value-objects/reward-tier";
import type { Reward } from "./value-objects/reward";

interface LoyaltyAccountProps {
  readonly customerRef: string;
  status: AccountStatus;
  points: LoyaltyPoint;
  readonly tiers: readonly RewardTier[];
  tierName: string;
  readonly transactions: LoyaltyTransaction[];
}

/**
 * Source of truth for a customer's points wallet, tier, and reward redemption (Sprint 5.1). Points
 * are not money — this context captures no payment. Rewards emit events but never modify orders
 * directly.
 */
export class LoyaltyAccount extends AggregateRoot<LoyaltyAccountProps> {
  static create(
    id: UniqueEntityId,
    customerRef: string,
    tiers: readonly RewardTier[],
  ): LoyaltyAccount {
    const startingTier = resolveTier(0, tiers);
    return new LoyaltyAccount(
      {
        customerRef,
        status: AccountStatus.active(),
        points: LoyaltyPoint.zero(),
        tiers,
        tierName: startingTier.name,
        transactions: [],
      },
      id,
    );
  }

  /** Rebuilds a persisted account exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    customerRef: string,
    tiers: readonly RewardTier[],
    tierName: string,
    balance: number,
    status: AccountStatus,
    version: number,
    transactions: readonly LoyaltyTransaction[] = [],
  ): LoyaltyAccount {
    return new LoyaltyAccount(
      {
        customerRef,
        status,
        points: LoyaltyPoint.from(balance),
        tiers,
        tierName,
        transactions: [...transactions],
      },
      id,
      version,
    );
  }

  /** The generic, validated status transition — `suspend`/`reactivate`/`close` all delegate to this. */
  transition(toStatus: AccountStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionAccount(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition loyalty account from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = AccountStatus.from(toStatus);
    const action = toStatus === "active" ? "opened" : toStatus;
    this.raise("account", action, eventId, occurredAt);
  }

  suspend(eventId: string, occurredAt: Date): void {
    this.transition("suspended", eventId, occurredAt);
  }

  reactivate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  close(eventId: string, occurredAt: Date): void {
    this.transition("closed", eventId, occurredAt);
  }

  /** Earns points (e.g. from a purchase) — idempotent by `idempotencyKey` (a replay is a silent no-op). */
  earn(
    idempotencyKey: string,
    points: number,
    ref: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (this.hasTransaction(idempotencyKey)) return;
    this.requireActive();
    this.recordTransaction(idempotencyKey, "earn", points, ref, occurredAt);
    this.props.points = this.props.points.add(points);
    this.raise("points", "earned", eventId, occurredAt, ref);
    this.checkTierUpgrade(eventId, occurredAt);
  }

  /** Records a cashback earning — idempotent, collapses into the same `points.earned` event type as `earn`. */
  recordCashback(
    idempotencyKey: string,
    points: number,
    ref: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (this.hasTransaction(idempotencyKey)) return;
    this.requireActive();
    this.recordTransaction(idempotencyKey, "cashback", points, ref, occurredAt);
    this.props.points = this.props.points.add(points);
    this.raise("points", "earned", eventId, occurredAt, ref);
    this.checkTierUpgrade(eventId, occurredAt);
  }

  /** Spends points — idempotent by `idempotencyKey`, throws if the balance is insufficient. */
  spend(
    idempotencyKey: string,
    points: number,
    ref: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (this.hasTransaction(idempotencyKey)) return;
    this.requireActive();
    if (!this.props.points.isAtLeast(points)) {
      throw new BusinessRuleError("Insufficient loyalty points balance");
    }
    this.recordTransaction(idempotencyKey, "spend", -points, ref, occurredAt);
    this.props.points = this.props.points.subtract(points);
    this.raise("points", "spent", eventId, occurredAt, ref);
  }

  /** Redeems a catalog reward for points — idempotent by `idempotencyKey`. Never modifies orders directly. */
  redeemReward(idempotencyKey: string, reward: Reward, eventId: string, occurredAt: Date): void {
    if (this.hasTransaction(idempotencyKey)) return;
    this.requireActive();
    if (!this.props.points.isAtLeast(reward.costPoints)) {
      throw new BusinessRuleError("Insufficient loyalty points balance to redeem this reward");
    }
    this.recordTransaction(
      idempotencyKey,
      "spend",
      -reward.costPoints,
      reward.rewardRef,
      occurredAt,
    );
    this.props.points = this.props.points.subtract(reward.costPoints);
    this.raise("reward", "redeemed", eventId, occurredAt, reward.rewardRef);
  }

  /** Completes a referral bonus — idempotent by `idempotencyKey`. */
  completeReferral(
    idempotencyKey: string,
    bonusPoints: number,
    referredCustomerRef: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    if (this.hasTransaction(idempotencyKey)) return;
    this.requireActive();
    this.recordTransaction(
      idempotencyKey,
      "referral",
      bonusPoints,
      referredCustomerRef,
      occurredAt,
    );
    this.props.points = this.props.points.add(bonusPoints);
    this.raise("referral", "completed", eventId, occurredAt, referredCustomerRef);
    this.checkTierUpgrade(eventId, occurredAt);
  }

  private checkTierUpgrade(eventId: string, occurredAt: Date): void {
    const newTier = resolveTier(this.props.points.balance, this.props.tiers);
    if (newTier.name !== this.props.tierName) {
      this.props.tierName = newTier.name;
      this.raise("tier", "upgraded", eventId, occurredAt, newTier.name);
    }
  }

  private recordTransaction(
    idempotencyKey: string,
    kind: LoyaltyTransaction["kind"],
    pointsDelta: number,
    ref: string,
    occurredAt: Date,
  ): void {
    this.props.transactions.push(
      LoyaltyTransaction.create(
        UniqueEntityId.from(this.id.toString() + this.props.transactions.length),
        idempotencyKey,
        kind,
        pointsDelta,
        occurredAt,
        ref,
      ),
    );
  }

  private raise(
    family: "account" | "points" | "tier" | "reward" | "referral",
    action: string,
    eventId: string,
    occurredAt: Date,
    ref?: string,
  ): void {
    this.addDomainEvent(
      new LoyaltyTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          customerRef: this.props.customerRef,
          family,
          action,
          balance: this.props.points.balance,
          ref,
        },
      ),
    );
  }

  private requireActive(): void {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(
        `Loyalty account is not active (status: ${this.props.status.value})`,
      );
    }
  }

  hasTransaction(idempotencyKey: string): boolean {
    return this.props.transactions.some((t) => t.idempotencyKey === idempotencyKey);
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get status(): AccountStatus {
    return this.props.status;
  }

  get points(): LoyaltyPoint {
    return this.props.points;
  }

  get tiers(): readonly RewardTier[] {
    return this.props.tiers;
  }

  get tierName(): string {
    return this.props.tierName;
  }

  /** The append-only points ledger (persisted verbatim). */
  get transactions(): readonly LoyaltyTransaction[] {
    return this.props.transactions;
  }
}
