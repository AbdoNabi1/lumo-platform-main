import { UniqueEntityId } from "@platform/domain";
import { Coupon } from "../domain/coupon";
import { CouponRedemption } from "../domain/coupon-redemption";
import { CouponCode } from "../domain/value-objects/coupon-code";
import { CouponStatus, type CouponStatusValue } from "../domain/value-objects/coupon-status";

export interface CouponRedemptionJson {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly customerRef: string;
  readonly orderRef?: string;
  readonly occurredAt: string;
}

export interface CouponRow {
  readonly id: string;
  readonly code: string;
  readonly promotionRef: string;
  readonly multiUse: boolean;
  readonly customerRef: string | null;
  readonly campaignRef: string | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly expiresAt: Date | null;
  readonly status: string;
  readonly redemptions: readonly CouponRedemptionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Coupon}. Mapping only — no I/O. */
export class CouponMapper {
  static toDomain(row: CouponRow): Coupon {
    const code = CouponCode.create(row.code);
    if (!code.ok) throw new Error(`Corrupt coupon row: invalid code (${code.error.message})`);

    return Coupon.reconstitute(
      UniqueEntityId.from(row.id),
      code.value,
      row.promotionRef,
      row.multiUse,
      row.customerRef ?? undefined,
      row.campaignRef ?? undefined,
      row.usageLimit ?? undefined,
      row.usageCount,
      row.expiresAt ?? undefined,
      CouponStatus.from(row.status as CouponStatusValue),
      row.version,
      row.redemptions.map((r) =>
        CouponRedemption.create(
          UniqueEntityId.from(r.id),
          r.idempotencyKey,
          r.customerRef,
          new Date(r.occurredAt),
          r.orderRef,
        ),
      ),
    );
  }

  static toRow(coupon: Coupon, tenantId: string) {
    return {
      id: coupon.id.toString(),
      tenantId,
      code: coupon.code.value,
      promotionRef: coupon.promotionRef,
      multiUse: coupon.multiUse,
      customerRef: coupon.customerRef ?? null,
      campaignRef: coupon.campaignRef ?? null,
      usageLimit: coupon.usageLimit ?? null,
      usageCount: coupon.usageCount,
      expiresAt: coupon.expiresAt ?? null,
      status: coupon.status.value,
      redemptions: coupon.redemptions.map((r) => ({
        id: r.id.toString(),
        idempotencyKey: r.idempotencyKey,
        customerRef: r.customerRef,
        orderRef: r.orderRef,
        occurredAt: r.occurredAt.toISOString(),
      })),
      version: 1,
    };
  }
}
