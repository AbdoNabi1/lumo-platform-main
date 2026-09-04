import { UniqueEntityId } from "@platform/domain";
import { Promotion } from "../domain/promotion";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
  type PromotionRewardType,
  type PromotionRuleType,
  type PromotionScope,
} from "../domain/value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "../domain/value-objects/promotion-schedule";
import {
  PromotionStatus,
  type PromotionStatusValue,
} from "../domain/value-objects/promotion-status";

export interface PromotionRow {
  readonly id: string;
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
  readonly endsAt: Date | null;
  readonly customerRefs: readonly string[] | null;
  readonly segmentRefs: readonly string[] | null;
  readonly campaignRef: string | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly status: string;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Promotion}. Mapping only — no I/O. */
export class PromotionMapper {
  static toDomain(row: PromotionRow): Promotion {
    const condition = PromotionCondition.create({
      scope: row.scope,
      targetRefs: row.targetRefs,
      minimumQuantity: row.minimumQuantity,
      minimumSubtotalAmountMinor: row.minimumSubtotalAmountMinor,
    });
    const reward = PromotionReward.create({
      type: row.rewardType,
      value: row.rewardValue,
      buyQuantity: row.buyQuantity,
      getQuantity: row.getQuantity,
    });
    if (!reward.ok)
      throw new Error(`Corrupt promotion row: invalid reward (${reward.error.message})`);
    const rule = PromotionRule.create(
      row.ruleType,
      condition,
      reward.value,
      row.stackable,
      row.priority,
    );
    if (!rule.ok) throw new Error(`Corrupt promotion row: invalid rule (${rule.error.message})`);

    return Promotion.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      rule.value,
      PromotionSchedule.create(row.startsAt, row.endsAt ?? undefined),
      row.customerRefs === null && row.segmentRefs === null
        ? CustomerEligibility.everyone()
        : CustomerEligibility.create({
            customerRefs: row.customerRefs ?? undefined,
            segmentRefs: row.segmentRefs ?? undefined,
          }),
      PromotionCampaign.create(row.campaignRef ?? undefined),
      row.usageLimit ?? undefined,
      row.usageCount,
      PromotionStatus.from(row.status as PromotionStatusValue),
      row.version,
    );
  }

  static toRow(promotion: Promotion, tenantId: string) {
    return {
      id: promotion.id.toString(),
      tenantId,
      name: promotion.name,
      ruleType: promotion.rule.type,
      scope: promotion.rule.condition.scope,
      targetRefs: promotion.rule.condition.targetRefs,
      reward: {
        type: promotion.rule.reward.type,
        value: promotion.rule.reward.value,
        buyQuantity: promotion.rule.reward.buyQuantity,
        getQuantity: promotion.rule.reward.getQuantity,
      },
      stackable: promotion.rule.stackable,
      priority: promotion.rule.priority,
      startsAt: promotion.schedule.startsAt,
      endsAt: promotion.schedule.endsAt ?? null,
      campaignRef: promotion.campaign.campaignRef ?? null,
      usageLimit: promotion.usageLimit ?? null,
      usageCount: promotion.usageCount,
      status: promotion.status.value,
      version: 1,
    };
  }
}
