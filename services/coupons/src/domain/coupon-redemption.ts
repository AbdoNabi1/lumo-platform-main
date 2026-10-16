import { Entity, type UniqueEntityId } from "@platform/domain";

interface CouponRedemptionProps {
  readonly idempotencyKey: string;
  readonly customerRef: string;
  readonly orderRef?: string;
  readonly email?: string;
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
    email?: string,
  ): CouponRedemption {
    return new CouponRedemption(
      {
        idempotencyKey,
        customerRef,
        orderRef,
        occurredAt,
        ...(email === undefined ? {} : { email }),
      },
      id,
    );
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

  get email(): string | undefined {
    return this.props.email;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
