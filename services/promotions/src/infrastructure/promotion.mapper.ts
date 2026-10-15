import { UniqueEntityId } from "@platform/domain";
import { Promotion } from "../domain/promotion";
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  type CombinesWith,
  type DiscountMethod,
} from "../domain/value-objects/discount-settings";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
  type PromotionRewardProps,
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
  /** Phase 2 reward fields (buy X get Y, free shipping, once per order); absent on older rows. */
  readonly rewardExtras?: Omit<
    PromotionRewardProps,
    "type" | "value" | "buyQuantity" | "getQuantity"
  >;
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
  readonly method: DiscountMethod | null;
  readonly combinesWith: CombinesWith | null;
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
      ...row.rewardExtras,
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
      {
        method: row.method ?? undefined,
        combinesWith:
          row.combinesWith ?? (row.stackable ? COMBINES_WITH_EVERYTHING : COMBINES_WITH_NOTHING),
      },
    );
  }

  static toRow(promotion: Promotion, tenantId: string) {
    const { condition, reward } = promotion.rule;
    return {
      id: promotion.id.toString(),
      tenantId,
      name: promotion.name,
      ruleType: promotion.rule.type,
      scope: condition.scope,
      targetRefs: [...condition.targetRefs],
      minimumQuantity: condition.minimumQuantity ?? null,
      minimumSubtotalAmountMinor: condition.minimumSubtotalAmountMinor ?? null,
      reward: JSON.parse(JSON.stringify(reward.toProps())) as Record<string, unknown>,
      stackable: promotion.rule.stackable,
      priority: promotion.rule.priority,
      startsAt: promotion.schedule.startsAt,
      endsAt: promotion.schedule.endsAt ?? null,
      customerRefs: promotion.eligibility.customerRefs ?? null,
      segmentRefs: promotion.eligibility.segmentRefs ?? null,
      campaignRef: promotion.campaign.campaignRef ?? null,
      usageLimit: promotion.usageLimit ?? null,
      usageCount: promotion.usageCount,
      status: promotion.status.value,
      method: promotion.method ?? null,
      discountClass: promotion.discountClass,
      combinesWith: { ...promotion.combinesWith },
      version: 1,
    };
  }
}

/** Adapts a stored `promotions` record (JSON columns untyped) to the mapper's {@link PromotionRow}. */
export function promotionRowFromRecord(row: {
  readonly id: string;
  readonly name: string;
  readonly ruleType: string;
  readonly scope: string;
  readonly targetRefs: unknown;
  readonly minimumQuantity: number | null;
  readonly minimumSubtotalAmountMinor: number | null;
  readonly reward: unknown;
  readonly stackable: boolean;
  readonly priority: number;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly customerRefs: unknown;
  readonly segmentRefs: unknown;
  readonly campaignRef: string | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly status: string;
  readonly method: string | null;
  readonly combinesWith: unknown;
  readonly version: number;
}): PromotionRow {
  const reward = row.reward as PromotionRewardProps;
  return {
    id: row.id,
    name: row.name,
    ruleType: row.ruleType as PromotionRow["ruleType"],
    scope: row.scope as PromotionRow["scope"],
    targetRefs: row.targetRefs as readonly string[],
    minimumQuantity: row.minimumQuantity ?? undefined,
    minimumSubtotalAmountMinor: row.minimumSubtotalAmountMinor ?? undefined,
    rewardType: reward.type,
    rewardValue: reward.value,
    buyQuantity: reward.buyQuantity,
    getQuantity: reward.getQuantity,
    rewardExtras: {
      appliesOncePerOrder: reward.appliesOncePerOrder,
      countries: reward.countries,
      maxShippingRateMinor: reward.maxShippingRateMinor,
      buys: reward.buys,
      gets: reward.gets,
      maxUsesPerOrder: reward.maxUsesPerOrder,
    },
    stackable: row.stackable,
    priority: row.priority,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    customerRefs: row.customerRefs as readonly string[] | null,
    segmentRefs: row.segmentRefs as readonly string[] | null,
    campaignRef: row.campaignRef,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    status: row.status,
    method: row.method as PromotionRow["method"],
    combinesWith: row.combinesWith as PromotionRow["combinesWith"],
    version: row.version,
  };
}
