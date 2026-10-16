import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { PromotionTransitioned } from "./events/promotion-transitioned.event";
import type { CartSnapshot, PromotionRule } from "./value-objects/promotion-rule";
import type {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "./value-objects/promotion-schedule";
import {
  canTransitionPromotion,
  PromotionStatus,
  type PromotionStatusValue,
} from "./value-objects/promotion-status";
import {
  COMBINES_WITH_EVERYTHING,
  COMBINES_WITH_NOTHING,
  discountClassOf,
  type CombinesWith,
  type DiscountClass,
  type DiscountMethod,
} from "./value-objects/discount-settings";

export interface PromotionDetermination {
  readonly promotionId: string;
  readonly discountAmountMinor: number;
  readonly stackable: boolean;
  readonly priority: number;
}

/** Phase 2 settings. Absent `method` = created before Phase 2: reachable only through its coupon. */
export interface PromotionSettings {
  readonly method?: DiscountMethod;
  readonly combinesWith?: CombinesWith;
}

/** Every field the merchant may edit on an existing discount (type and method excluded). */
export interface PromotionChanges {
  readonly name: string;
  readonly rule: PromotionRule;
  readonly schedule: PromotionSchedule;
  readonly eligibility: CustomerEligibility;
  readonly usageLimit?: number;
  readonly combinesWith: CombinesWith;
}

/** How Shopify shows a discount at a moment. Drafts are not running, so they read as expired. */
export type PromotionView = "active" | "scheduled" | "expired" | "archived";

interface PromotionProps {
  name: string;
  rule: PromotionRule;
  schedule: PromotionSchedule;
  eligibility: CustomerEligibility;
  readonly campaign: PromotionCampaign;
  usageLimit?: number;
  usageCount: number;
  status: PromotionStatus;
  readonly method?: DiscountMethod;
  combinesWith: CombinesWith;
}

/**
 * Source of truth for a promotion's own lifecycle and its discount **determination** (Sprint 5.1).
 * Never sets a price itself — Pricing owns prices, Checkout applies determinations, Orders only
 * snapshot. `evaluate()` is pure: no mutation, no domain event, matching the report's own
 * "determination only" ownership rule.
 */
export class Promotion extends AggregateRoot<PromotionProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    rule: PromotionRule,
    schedule: PromotionSchedule,
    eligibility: CustomerEligibility,
    campaign: PromotionCampaign,
    usageLimit?: number,
    settings: PromotionSettings = {},
  ): Promotion {
    return new Promotion(
      {
        name,
        rule,
        schedule,
        eligibility,
        campaign,
        usageLimit,
        usageCount: 0,
        status: PromotionStatus.draft(),
        method: settings.method,
        combinesWith:
          settings.combinesWith ??
          (rule.stackable ? COMBINES_WITH_EVERYTHING : COMBINES_WITH_NOTHING),
      },
      id,
    );
  }

  /** Rebuilds a persisted promotion exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    rule: PromotionRule,
    schedule: PromotionSchedule,
    eligibility: CustomerEligibility,
    campaign: PromotionCampaign,
    usageLimit: number | undefined,
    usageCount: number,
    status: PromotionStatus,
    version: number,
    settings: PromotionSettings = {},
  ): Promotion {
    return new Promotion(
      {
        name,
        rule,
        schedule,
        eligibility,
        campaign,
        usageLimit,
        usageCount,
        status,
        method: settings.method,
        combinesWith:
          settings.combinesWith ??
          (rule.stackable ? COMBINES_WITH_EVERYTHING : COMBINES_WITH_NOTHING),
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every named method below delegates to this. */
  transition(toStatus: PromotionStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionPromotion(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition promotion from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = PromotionStatus.from(toStatus);
    this.addDomainEvent(
      new PromotionTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          fromStatus,
          toStatus,
        },
      ),
    );
  }

  scheduleActivation(eventId: string, occurredAt: Date): void {
    this.transition("scheduled", eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  pause(eventId: string, occurredAt: Date): void {
    this.transition("paused", eventId, occurredAt);
  }

  resume(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  expire(eventId: string, occurredAt: Date): void {
    this.transition("expired", eventId, occurredAt);
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  /** Records one application of this promotion — auto-transitions to `depleted` once the usage limit is reached. */
  recordUsage(eventId: string, occurredAt: Date): void {
    this.props.usageCount += 1;
    if (this.props.usageLimit !== undefined && this.props.usageCount >= this.props.usageLimit) {
      this.transition("depleted", eventId, occurredAt);
    }
  }

  /** Applies the merchant's edits. The type (class and rule type) can never change, as in Shopify. */
  update(changes: PromotionChanges): void {
    if (this.props.status.value === "archived") {
      throw new BusinessRuleError("An archived discount cannot be edited");
    }
    if (
      changes.rule.type !== this.props.rule.type ||
      discountClassOf(changes.rule) !== this.discountClass
    ) {
      throw new BusinessRuleError("A discount's type cannot be changed");
    }
    this.props.name = changes.name;
    this.props.rule = changes.rule;
    this.props.schedule = changes.schedule;
    this.props.eligibility = changes.eligibility;
    this.props.usageLimit = changes.usageLimit;
    this.props.combinesWith = changes.combinesWith;
  }

  /** Shopify's status column at `now`: Active, Scheduled or Expired (deactivated reads as expired). */
  viewAt(now: Date): PromotionView {
    const status = this.props.status.value;
    if (status === "archived") return "archived";
    if (status !== "active" && status !== "scheduled") return "expired";
    if (this.props.schedule.isExpiredAt(now)) return "expired";
    if (now.getTime() < this.props.schedule.startsAt.getTime()) return "scheduled";
    return status === "active" ? "active" : "scheduled";
  }

  /**
   * Determines whether — and by how much — this promotion discounts the given cart right now.
   * Pure: no mutation, no domain event. Returns `null` if the promotion does not apply.
   */
  evaluate(
    cart: CartSnapshot,
    customerRef: string,
    segmentRefs: readonly string[],
    now: Date,
  ): PromotionDetermination | null {
    if (this.props.status.value !== "active") return null;
    if (!this.props.schedule.isActiveAt(now)) return null;
    if (!this.props.eligibility.isEligible(customerRef, segmentRefs)) return null;
    if (this.props.usageLimit !== undefined && this.props.usageCount >= this.props.usageLimit) {
      return null;
    }
    if (!this.props.rule.condition.matches(cart)) return null;

    return {
      promotionId: this.id.toString(),
      discountAmountMinor: this.props.rule.reward.discountAmountMinor(
        this.props.rule.condition.matchedSubtotalAmountMinor(cart),
      ),
      stackable: this.props.rule.stackable,
      priority: this.props.rule.priority,
    };
  }

  get name(): string {
    return this.props.name;
  }

  get rule(): PromotionRule {
    return this.props.rule;
  }

  get schedule(): PromotionSchedule {
    return this.props.schedule;
  }

  get eligibility(): CustomerEligibility {
    return this.props.eligibility;
  }

  get campaign(): PromotionCampaign {
    return this.props.campaign;
  }

  get usageLimit(): number | undefined {
    return this.props.usageLimit;
  }

  get usageCount(): number {
    return this.props.usageCount;
  }

  get status(): PromotionStatus {
    return this.props.status;
  }

  get method(): DiscountMethod | undefined {
    return this.props.method;
  }

  get combinesWith(): CombinesWith {
    return this.props.combinesWith;
  }

  get discountClass(): DiscountClass {
    return discountClassOf(this.props.rule);
  }
}
