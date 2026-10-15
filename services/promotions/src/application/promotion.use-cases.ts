import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type CursorPage, type Paginated, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { PromotionDetermination } from "../domain/promotion";
import { Promotion } from "../domain/promotion";
import type { AdminPromotionQuery, PromotionRepository } from "../domain/promotion-repository";
import type { CombinesWith, DiscountMethod } from "../domain/value-objects/discount-settings";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
} from "../domain/value-objects/promotion-rule";
import type {
  BuyXGetYBuys,
  BuyXGetYGets,
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
  /** Phase 2. Absent = stored as NULL: reachable only through its coupon, never applied automatically. */
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
  readonly appliesOncePerOrder?: boolean;
  readonly countries?: readonly string[];
  readonly maxShippingRateMinor?: number;
  readonly buys?: BuyXGetYBuys;
  readonly gets?: BuyXGetYGets;
  readonly maxUsesPerOrder?: number;
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

type PromotionParts = {
  readonly rule: PromotionRule;
  readonly schedule: PromotionSchedule;
  readonly eligibility: CustomerEligibility;
};

function buildPromotionParts(
  input: Omit<CreatePromotionInput, "tenantId" | "method" | "campaignRef">,
): Result<PromotionParts, DomainError> {
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
    appliesOncePerOrder: input.appliesOncePerOrder,
    countries: input.countries,
    maxShippingRateMinor: input.maxShippingRateMinor,
    buys: input.buys,
    gets: input.gets,
    maxUsesPerOrder: input.maxUsesPerOrder,
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
  return ok({
    rule: rule.value,
    schedule: PromotionSchedule.create(input.startsAt, input.endsAt),
    eligibility:
      input.customerRefs === undefined && input.segmentRefs === undefined
        ? CustomerEligibility.everyone()
        : CustomerEligibility.create({
            customerRefs: input.customerRefs,
            segmentRefs: input.segmentRefs,
          }),
  });
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
    const parts = buildPromotionParts(input);
    if (!parts.ok) return err(parts.error);

    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const promotion = Promotion.create(
        id,
        input.name,
        parts.value.rule,
        parts.value.schedule,
        parts.value.eligibility,
        PromotionCampaign.create(input.campaignRef),
        input.usageLimit,
        { method: input.method, combinesWith: input.combinesWith },
      );
      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: id.toString(), status: promotion.status.value });
    });
  }
}

export type UpdatePromotionInput = Omit<CreatePromotionInput, "method" | "campaignRef"> & {
  readonly promotionId: string;
};

/** Applies the merchant's edits to a discount (Phase 2). Type and method never change. */
export class UpdatePromotion implements UseCase<
  UpdatePromotionInput,
  PromotionStatusOutput,
  DomainError
> {
  private readonly deps: PromotionDeps;

  constructor(deps: PromotionDeps) {
    this.deps = deps;
  }

  async execute(input: UpdatePromotionInput): Promise<Result<PromotionStatusOutput, DomainError>> {
    const parts = buildPromotionParts(input);
    if (!parts.ok) return err(parts.error);
    return this.deps.unitOfWork.run<Result<PromotionStatusOutput, DomainError>>(async (tx) => {
      const promotion = await this.deps.promotions.findById(input.promotionId, input.tenantId, tx);
      if (promotion === null) return err(new NotFoundError("Promotion not found"));
      try {
        promotion.update({
          name: input.name,
          ...parts.value,
          usageLimit: input.usageLimit,
          combinesWith: input.combinesWith ?? promotion.combinesWith,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.promotions.save(promotion, input.tenantId, tx);
      return ok({ promotionId: promotion.id.toString(), status: promotion.status.value });
    });
  }
}

/** The automatic promotions checkout evaluates on every cart (Phase 2). */
export class ListActiveAutomaticPromotions implements UseCase<
  { readonly tenantId: string },
  { readonly items: readonly Promotion[] },
  DomainError
> {
  private readonly deps: Pick<PromotionDeps, "promotions">;

  constructor(deps: Pick<PromotionDeps, "promotions">) {
    this.deps = deps;
  }

  async execute(input: { readonly tenantId: string }) {
    return ok({ items: await this.deps.promotions.findActiveAutomatic(input.tenantId) });
  }
}

export interface ListPromotionsForAdminInput extends CursorPage {
  readonly tenantId: string;
  readonly view: AdminPromotionQuery["view"];
  readonly search?: string;
  readonly alsoIds?: readonly string[];
}

/** The admin Discounts list (Phase 2): Shopify's tabs and search, newest first. */
export class ListPromotionsForAdmin implements UseCase<
  ListPromotionsForAdminInput,
  Paginated<Promotion>,
  DomainError
> {
  private readonly deps: Pick<PromotionDeps, "promotions" | "clock">;

  constructor(deps: Pick<PromotionDeps, "promotions" | "clock">) {
    this.deps = deps;
  }

  async execute(
    input: ListPromotionsForAdminInput,
  ): Promise<Result<Paginated<Promotion>, DomainError>> {
    const { tenantId, ...query } = input;
    return ok(
      await this.deps.promotions.listForAdmin({ ...query, now: this.deps.clock.now() }, tenantId),
    );
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
