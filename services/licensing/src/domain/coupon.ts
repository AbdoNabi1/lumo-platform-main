import {
  AggregateRoot,
  BusinessRuleError,
  Money,
  isValidCurrencyCode,
  type UniqueEntityId,
} from "@platform/domain";
import { LicensingChanged } from "./events/licensing-changed.event";

export type CouponStatus = "issued" | "redeemed" | "expired" | "revoked";

/**
 * The lifecycle machine (issue, redeem, expire, revoke). `issued` is the ONLY status with an edge
 * out, and every terminal status has none — so a coupon is redeemable exactly once, and a redeemed,
 * expired or revoked one cannot be brought back. Same shape as `Subscription`/`Invoice`: the
 * aggregate consults this table in {@link Coupon.transition}, a caller cannot bypass it with a
 * forgotten `if`.
 */
const TRANSITIONS: Record<CouponStatus, readonly CouponStatus[]> = {
  issued: ["redeemed", "expired", "revoked"],
  redeemed: [],
  expired: [],
  revoked: [],
};

/**
 * What a coupon is worth. A percentage carries NO currency (it is a fraction of whatever the invoice
 * is); a fixed amount carries one and is refused — never converted — against an invoice in another
 * currency. `basisPoints` is an integer in 1..10000 (100 bp = 1%), so percentage maths is exact
 * integer arithmetic, not float.
 */
export type CouponValue =
  | { readonly kind: "percentage"; readonly basisPoints: number }
  | { readonly kind: "fixed"; readonly amountMinor: number; readonly currency: string };

export interface CouponRedemption {
  readonly invoiceRef: string;
  readonly redeemedAt: Date;
}

export interface CouponIssue {
  readonly code: string;
  readonly value: CouponValue;
  /** After this instant the coupon can no longer be redeemed, whether or not a sweep has marked it `expired`. */
  readonly expiresAt: Date;
  /** Addressed to one merchant (`tenantRef`); absent ⇒ a bearer coupon any merchant may present. */
  readonly merchantRef?: string;
}

export interface CouponSnapshot extends CouponIssue {
  readonly status: CouponStatus;
  readonly redemption?: CouponRedemption;
  readonly revokedReason?: string;
}

interface CouponProps extends CouponSnapshot {
  status: CouponStatus;
  redemption?: CouponRedemption;
  revokedReason?: string;
}

const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;
const BASIS_POINTS_PER_WHOLE = 10_000n;

/**
 * A billing coupon (WP-14 T14.3): Morbeh-issued, so it is priced and issued by the platform only
 * (`LicensingController.platformOnly`); redeemed ONCE, onto a draft invoice, reducing what Morbeh
 * charges. A coupon never mutates money itself — {@link discountFor} computes a non-negative
 * {@link Money}, and `Invoice.applyDiscount` subtracts it (D-072).
 */
export class Coupon extends AggregateRoot<CouponProps> {
  static issue(id: UniqueEntityId, input: CouponIssue, eventId: string, occurredAt: Date): Coupon {
    const code = input.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new BusinessRuleError(
        "Coupon code must be 4-32 characters of A-Z, 0-9, underscore or hyphen",
      );
    }
    Coupon.assertValue(input.value);
    if (!(input.expiresAt.getTime() > occurredAt.getTime())) {
      throw new BusinessRuleError("Coupon expiry must be in the future");
    }
    const coupon = new Coupon(
      {
        code,
        value: input.value,
        expiresAt: input.expiresAt,
        ...(input.merchantRef === undefined ? {} : { merchantRef: input.merchantRef }),
        status: "issued",
      },
      id,
    );
    coupon.raise("issued", eventId, occurredAt);
    return coupon;
  }

  static reconstitute(id: UniqueEntityId, snapshot: CouponSnapshot, version: number): Coupon {
    return new Coupon({ ...snapshot }, id, version);
  }

  /**
   * Throws unless this coupon can be redeemed for `merchantRef` at `occurredAt`, and changes nothing.
   * Refuses (via the machine) any coupon that is not `issued`, then an elapsed expiry, then a coupon
   * addressed to someone else. {@link redeem} runs it itself; it is public so a caller composing
   * several aggregates can check ALL of them before mutating ANY (a refusal must leave no half-applied
   * change on an aggregate a repository may hand out by reference).
   */
  assertRedeemable(merchantRef: string, occurredAt: Date): void {
    this.assertCanMoveTo("redeemed");
    if (occurredAt.getTime() >= this.props.expiresAt.getTime()) {
      throw new BusinessRuleError(`Coupon ${this.props.code} has expired`);
    }
    if (this.props.merchantRef !== undefined && this.props.merchantRef !== merchantRef) {
      throw new BusinessRuleError(`Coupon ${this.props.code} is not valid for this merchant`);
    }
  }

  /** `merchantRef` is the merchant whose invoice this is redeemed onto. */
  redeem(invoiceRef: string, merchantRef: string, eventId: string, occurredAt: Date): void {
    this.assertRedeemable(merchantRef, occurredAt);
    this.props.redemption = { invoiceRef, redeemedAt: occurredAt };
    this.transition("redeemed", eventId, occurredAt, "redeemed");
  }

  /** Marks the coupon `expired` — only once its expiry has actually passed. */
  expire(eventId: string, occurredAt: Date): void {
    this.assertCanMoveTo("expired");
    if (occurredAt.getTime() < this.props.expiresAt.getTime()) {
      throw new BusinessRuleError(
        `Coupon ${this.props.code} has not reached its expiry and cannot be marked expired`,
      );
    }
    this.transition("expired", eventId, occurredAt, "expired");
  }

  revoke(reason: string, eventId: string, occurredAt: Date): void {
    this.assertCanMoveTo("revoked");
    this.props.revokedReason = reason;
    this.transition("revoked", eventId, occurredAt, "revoked");
  }

  /**
   * What this coupon takes off `subtotal`. Never negative and never zero, never converted, never
   * floored to fit: a fixed amount in another currency, a fixed amount worth more than the subtotal,
   * and a percentage that rounds to nothing are all refused. A percentage rounds DOWN to whole minor
   * units (BigInt, so a subtotal near 2^53 does not overflow the multiplication).
   */
  discountFor(subtotal: Money): Money {
    const value = this.props.value;
    let minor: number;
    if (value.kind === "fixed") {
      if (value.currency !== subtotal.currency) {
        throw new BusinessRuleError(
          `Coupon ${this.props.code} is in ${value.currency} and cannot apply to a ${subtotal.currency} invoice (no currency conversion)`,
        );
      }
      minor = value.amountMinor;
    } else {
      minor = Number(
        (BigInt(subtotal.amountMinor) * BigInt(value.basisPoints)) / BASIS_POINTS_PER_WHOLE,
      );
    }
    if (minor === 0) {
      throw new BusinessRuleError(
        `Coupon ${this.props.code} would discount nothing on this invoice`,
      );
    }
    if (minor > subtotal.amountMinor) {
      throw new BusinessRuleError(
        `Coupon ${this.props.code} is worth more than the invoice subtotal and is refused, not floored to zero`,
      );
    }
    const money = Money.create(minor, subtotal.currency);
    if (!money.ok) throw new BusinessRuleError("Coupon discount is not a valid amount");
    return money.value;
  }

  private static assertValue(value: CouponValue): void {
    if (value.kind === "percentage") {
      if (
        !Number.isInteger(value.basisPoints) ||
        value.basisPoints < 1 ||
        value.basisPoints > 10_000
      ) {
        throw new BusinessRuleError("Coupon basisPoints must be an integer from 1 to 10000");
      }
      return;
    }
    if (!Number.isSafeInteger(value.amountMinor) || value.amountMinor < 1) {
      throw new BusinessRuleError("Coupon amountMinor must be a positive integer of minor units");
    }
    if (!isValidCurrencyCode(value.currency)) {
      throw new BusinessRuleError(
        `Invalid coupon currency "${value.currency}" (ISO-4217, 3 capitals)`,
      );
    }
  }

  private assertCanMoveTo(to: CouponStatus): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(`Cannot transition coupon from ${this.props.status} to ${to}`);
    }
  }

  private transition(to: CouponStatus, eventId: string, occurredAt: Date, action: string): void {
    this.assertCanMoveTo(to);
    this.props.status = to;
    this.raise(action, eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new LicensingChanged(
        { eventId, aggregateId: this.id, occurredAt },
        { ref: this.props.merchantRef ?? this.props.code, family: "coupon", action },
      ),
    );
  }

  get code(): string {
    return this.props.code;
  }

  get value(): CouponValue {
    return this.props.value;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  /** The merchant this coupon is addressed to, if any. */
  get merchantRef(): string | undefined {
    return this.props.merchantRef;
  }

  get status(): CouponStatus {
    return this.props.status;
  }

  get redemption(): CouponRedemption | undefined {
    return this.props.redemption;
  }

  get revokedReason(): string | undefined {
    return this.props.revokedReason;
  }
}
