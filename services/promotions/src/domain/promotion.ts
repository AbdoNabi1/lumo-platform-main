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

export interface PromotionDetermination {
  readonly promotionId: string;
  readonly discountAmountMinor: number;
  readonly stackable: boolean;
  readonly priority: number;
}

interface PromotionProps {
  readonly name: string;
  readonly rule: PromotionRule;
  readonly schedule: PromotionSchedule;
  readonly eligibility: CustomerEligibility;
  readonly campaign: PromotionCampaign;
  readonly usageLimit?: number;
  usageCount: number;
  status: PromotionStatus;
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
  ): Promotion {
    return new Promotion(
      { name, rule, schedule, eligibility, campaign, usageLimit, usageCount, status },
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
      discountAmountMinor: this.props.rule.reward.discountAmountMinor(cart.subtotalAmountMinor),
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
}
