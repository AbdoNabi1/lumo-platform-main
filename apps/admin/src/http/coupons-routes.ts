import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Coupon } from "@platform/coupons";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const createCouponBody = z.object({
  code: z.string().min(1),
  promotionRef: z.string().min(1),
  multiUse: z.boolean(),
  usageLimit: z.number().int().positive().optional(),
  customerRef: z.string().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
  campaignRef: z.string().min(1).optional(),
});
const couponIdParams = z.object({ couponId: z.string().min(1) });
const advanceCouponBody = z.object({
  toStatus: z.enum(["active", "disabled", "expired", "depleted"]),
});
const redeemCouponBody = z.object({
  code: z.string().min(1),
  customerRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  orderRef: z.string().min(1).optional(),
});
const listCouponsQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
});

/** `Coupon` (`@platform/coupons`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}. */
export interface CouponListItemDto {
  readonly id: string;
  readonly code: string;
  readonly promotionRef: string;
  readonly status: string;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly expiresAt: string | null;
}

function toCouponListItemDto(coupon: Coupon): CouponListItemDto {
  return {
    id: coupon.id.toString(),
    code: coupon.code.value,
    promotionRef: coupon.promotionRef,
    status: coupon.status.value,
    usageLimit: coupon.usageLimit ?? null,
    usageCount: coupon.usageCount,
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
  };
}

/** The Coupons admin HTTP surface (Sprint S1). Pure delegation. */
export function couponsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/coupons",
      version: 1,
      permission: "coupons:create",
      idempotent: true,
      summary: "Create a coupon",
      schema: { body: createCouponBody },
      handle: ({ body, context }) =>
        admin.coupons.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/coupons/:couponId/transitions",
      version: 1,
      permission: "coupons:advance",
      idempotent: true,
      summary: "Advance a coupon's status (disable/reactivate/expire)",
      schema: { params: couponIdParams, body: advanceCouponBody },
      handle: ({ params, body, context }) =>
        admin.coupons.advance(context.principal, {
          couponId: params.couponId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/coupons",
      version: 1,
      permission: "coupons:read",
      summary: "List coupons, most recently created first (cursor-paginated)",
      schema: { querystring: listCouponsQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.coupons.list(context.principal, { ...query, tenantId: context.tenantId }),
          toCouponListItemDto,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/coupons/redeem",
      version: 1,
      permission: "coupons:redeem",
      idempotent: true,
      summary: "Redeem a coupon by code (idempotent by idempotencyKey)",
      schema: { body: redeemCouponBody },
      handle: ({ body, context }) =>
        admin.coupons.redeem(context.principal, { ...body, tenantId: context.tenantId }),
    }),
  ] as readonly RouteDefinition[];
}
