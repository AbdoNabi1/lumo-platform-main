import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CouponRedemption } from "./coupon-redemption";
import { CouponTransitioned } from "./events/coupon-transitioned.event";
import type { CouponCode } from "./value-objects/coupon-code";
import {
  canTransitionCoupon,
  CouponStatus,
  type CouponStatusValue,
} from "./value-objects/coupon-status";

interface CouponProps {
  code: CouponCode;
  readonly promotionRef: string;
  multiUse: boolean;
  readonly customerRef?: string;
  readonly campaignRef?: string;
  usageLimit?: number;
  usageCount: number;
  readonly expiresAt?: Date;
  status: CouponStatus;
  readonly redemptions: CouponRedemption[];
}

/**
 * Source of truth for a coupon's own lifecycle and redemption ledger (Sprint 5.1). Only
 * **authorizes** a promotion — never computes a discount itself (that is `Promotion.evaluate()`'s
 * job, reached via `PromotionsPort`).
 */
export class Coupon extends AggregateRoot<CouponProps> {
  static create(
    id: UniqueEntityId,
    code: CouponCode,
    promotionRef: string,
    multiUse: boolean,
    usageLimit?: number,
    customerRef?: string,
    expiresAt?: Date,
    campaignRef?: string,
  ): Coupon {
    return new Coupon(
      {
        code,
        promotionRef,
        multiUse,
        customerRef,
        campaignRef,
        usageLimit,
        usageCount: 0,
        expiresAt,
        status: CouponStatus.active(),
        redemptions: [],
      },
      id,
    );
  }

  /** Rebuilds a persisted coupon exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    code: CouponCode,
    promotionRef: string,
    multiUse: boolean,
    customerRef: string | undefined,
    campaignRef: string | undefined,
    usageLimit: number | undefined,
    usageCount: number,
    expiresAt: Date | undefined,
    status: CouponStatus,
    version: number,
    redemptions: readonly CouponRedemption[] = [],
  ): Coupon {
    return new Coupon(
      {
        code,
        promotionRef,
        multiUse,
        customerRef,
        campaignRef,
        usageLimit,
        usageCount,
        expiresAt,
        status,
        redemptions: [...redemptions],
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every named method below delegates to this. */
  transition(toStatus: CouponStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionCoupon(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition coupon from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = CouponStatus.from(toStatus);
    this.addDomainEvent(
      new CouponTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          code: this.props.code.value,
          promotionRef: this.props.promotionRef,
          fromStatus,
          toStatus,
        },
      ),
    );
  }

  disable(eventId: string, occurredAt: Date): void {
    this.transition("disabled", eventId, occurredAt);
  }

  reactivate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  expire(eventId: string, occurredAt: Date): void {
    this.transition("expired", eventId, occurredAt);
  }

  /**
   * Redeems this coupon for a customer, idempotently by `idempotencyKey` (the caller is expected to
   * have already deduped via `CouponRepository.hasRedemption`). Auto-transitions to `depleted` once
   * the usage limit is reached. Throws if the coupon is not currently redeemable.
   */
  redeem(
    idempotencyKey: string,
    customerRef: string,
    occurredAt: Date,
    eventId: string,
    orderRef?: string,
    email?: string,
  ): void {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(`Coupon is not active (status: ${this.props.status.value})`);
    }
    if (
      this.props.expiresAt !== undefined &&
      occurredAt.getTime() >= this.props.expiresAt.getTime()
    ) {
      throw new BusinessRuleError("Coupon has expired");
    }
    if (this.props.customerRef !== undefined && this.props.customerRef !== customerRef) {
      throw new BusinessRuleError("Coupon is not assigned to this customer");
    }
    const normalizedEmail = email?.toLowerCase();
    if (
      !this.props.multiUse &&
      this.props.redemptions.some(
        (r) =>
          r.customerRef === customerRef ||
          (normalizedEmail !== undefined && r.email?.toLowerCase() === normalizedEmail),
      )
    ) {
      throw new BusinessRuleError("Coupon has already been redeemed by this customer");
    }

    this.props.redemptions.push(
      CouponRedemption.create(
        UniqueEntityId.from(this.id.toString() + this.props.redemptions.length),
        idempotencyKey,
        customerRef,
        occurredAt,
        orderRef,
        email,
      ),
    );
    this.props.usageCount += 1;

    if (this.props.usageLimit !== undefined && this.props.usageCount >= this.props.usageLimit) {
      this.transition("depleted", eventId, occurredAt);
    }
  }

  /**
   * The merchant's edits to a discount code (Phase 2): the code itself, one-use-per-customer and the
   * total limit. Uniqueness of the new code is the use case's job (it needs the repository).
   */
  reconfigure(changes: {
    readonly code: CouponCode;
    readonly multiUse: boolean;
    readonly usageLimit?: number;
  }): void {
    this.props.code = changes.code;
    this.props.multiUse = changes.multiUse;
    this.props.usageLimit = changes.usageLimit;
  }

  get code(): CouponCode {
    return this.props.code;
  }

  get promotionRef(): string {
    return this.props.promotionRef;
  }

  get multiUse(): boolean {
    return this.props.multiUse;
  }

  get customerRef(): string | undefined {
    return this.props.customerRef;
  }

  get campaignRef(): string | undefined {
    return this.props.campaignRef;
  }

  get usageLimit(): number | undefined {
    return this.props.usageLimit;
  }

  get usageCount(): number {
    return this.props.usageCount;
  }

  get expiresAt(): Date | undefined {
    return this.props.expiresAt;
  }

  get status(): CouponStatus {
    return this.props.status;
  }

  /** The append-only redemption ledger (persisted verbatim). */
  get redemptions(): readonly CouponRedemption[] {
    return this.props.redemptions;
  }
}
