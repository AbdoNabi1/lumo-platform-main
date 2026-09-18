import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { PromotionDetermination } from "../domain/promotion";
import { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
} from "../domain/value-objects/promotion-rule";
import type {
  CartSnapshot,
  PromotionRewardType,
  PromotionRuleType,
  PromotionScope,
} from "../domain/value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "../domain/value-objects/promotion-schedule";
import type { PromotionStatusValue } from "../domain/value-objects/promotion-status";

export interface CreatePromotionInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly name: string;
  readonly ruleType: PromotionRuleType;
  readonly scope: PromotionScope;
  readonly targetRefs: readonly string[];
  readonly minimumQuantity?: number;
  readonly minimumSubtotalAmountMinor?: number;
  readonly rewardType: PromotionRewardType;
  readonly rewardValue?: number;
  readonly buyQuantity?: number;
  readonly getQuantity?: number;
  readonly stackable: boolean;
  readonly priority: number;
  readonly startsAt: Date;
  readonly endsAt?: Date;
  readonly customerRefs?: readonly string[];
  readonly segmentRefs?: readonly string[];
  readonly campaignRef?: string;
  readonly usageLimit?: number;
}

export interface PromotionStatusOutput {
  readonly promotionId: string;
  readonly status: string;
}

export interface PromotionIdInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly promotionId: string;
}

export interface AdvancePromotionInput extends PromotionIdInput {
  readonly toStatus: PromotionStatusValue;
}

export interface PromotionDeps {
  readonly promotions: PromotionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a promotion in `draft` status. */
export class CreatePromotion implements UseCase<
  CreatePromotionInput,
  PromotionStatusOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePromotionInput): Promise<Result<PromotionStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    const condition = PromotionCondition.create({
      scope: input.scope,
      targetRefs: input.targetRefs,
      minimumQuantity: input.minimumQuantity,
      minimumSubtotalAmountMinor: input.minimumSubtotalAmountMinor,
    });
    const reward = PromotionReward.create({
      type: input.rewardType,
      value: input.rewardValue,
      buyQuantity: input.buyQuantity,
      getQuantity: input.getQuantity,
    });
    if (!reward.ok) return err(reward.error);
    const rule = PromotionRule.create(
      input.ruleType,
      condition,
      reward.value,
      input.stackable,
      input.priority,
    );
    if (!rule.ok) return err(rule.error);

    if (input.endsAt !== undefined && input.endsAt.getTime() <= input.startsAt.getTime()) {
      return err(
        new ValidationError("Invalid promotion schedule", [
          { field: "endsAt", message: "must be after startsAt" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const promotion = Promotion.create(
        id,
        input.name,
        rule.value,
        PromotionSchedule.create(input.startsAt, input.endsAt),
        input.customerRefs === undefined && input.segmentRefs === undefined
          ? CustomerEligibility.everyone()
          : CustomerEligibility.create({
              customerRefs: input.customerRefs,
              segmentRefs: input.segmentRefs,
            }),
        PromotionCampaign.create(input.campaignRef),
        input.usageLimit,
      );
      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: id.toString(), status: promotion.status.value });
    });
  }
}

/** Generic validated transition — used for schedule/activate/pause/resume/expire/cancel/archive. */
export class AdvancePromotion implements UseCase<
  AdvancePromotionInput,
  PromotionStatusOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(input: AdvancePromotionInput): Promise<Result<PromotionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const promotion = await this.deps.promotions.findById(input.promotionId, input.tenantId, tx);
      if (promotion === null) return err(new NotFoundError("Promotion not found"));

      try {
        promotion.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: promotion.id.toString(), status: promotion.status.value });
    });
  }
}

export interface EvaluatePromotionsInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly cart: CartSnapshot;
  readonly customerRef: string;
  readonly segmentRefs?: readonly string[];
}

export interface EvaluatePromotionsOutput {
  readonly determinations: readonly PromotionDetermination[];
}

/** Evaluates every active promotion against a cart snapshot — pure read, no mutation, no events. */
export class EvaluatePromotions implements UseCase<
  EvaluatePromotionsInput,
  EvaluatePromotionsOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(
    input: EvaluatePromotionsInput,
  ): Promise<Result<EvaluatePromotionsOutput, DomainError>> {
    const active = await this.deps.promotions.findActive(input.tenantId);
    const now = this.deps.clock.now();
    const determinations = active
      .map((promotion) =>
        promotion.evaluate(input.cart, input.customerRef, input.segmentRefs ?? [], now),
      )
      .filter((determination): determination is PromotionDetermination => determination !== null);
    return ok({ determinations });
  }
}

/** Records one usage of a promotion (called by Coupons/Checkout after a redemption/application). */
export class RecordPromotionUsage implements UseCase<
  PromotionIdInput,
  PromotionStatusOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(input: PromotionIdInput): Promise<Result<PromotionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const promotion = await this.deps.promotions.findById(input.promotionId, input.tenantId, tx);
      if (promotion === null) return err(new NotFoundError("Promotion not found"));

      try {
        promotion.recordUsage(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: promotion.id.toString(), status: promotion.status.value });
    });
  }
}
