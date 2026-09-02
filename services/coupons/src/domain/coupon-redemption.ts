import { Entity, type UniqueEntityId } from "@platform/domain";

interface CouponRedemptionProps {
  readonly idempotencyKey: string;
  readonly customerRef: string;
  readonly orderRef?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for one redemption of a coupon (retry-safe idempotency trail; never rewritten). */
export class CouponRedemption extends Entity<CouponRedemptionProps> {
  static create(
    id: UniqueEntityId,
    idempotencyKey: string,
    customerRef: string,
    occurredAt: Date,
    orderRef?: string,
  ): CouponRedemption {
    return new CouponRedemption({ idempotencyKey, customerRef, orderRef, occurredAt }, id);
  }

  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get orderRef(): string | undefined {
    return this.props.orderRef;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
