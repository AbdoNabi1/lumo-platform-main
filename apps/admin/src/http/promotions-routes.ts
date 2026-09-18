import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Promotion } from "@platform/promotions";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface PromotionDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly ruleType: string;
  readonly scope: string;
  readonly targetRefs: readonly string[];
  readonly minimumQuantity: number | null;
  readonly minimumSubtotalAmountMinor: number | null;
  readonly rewardType: string;
  readonly rewardValue: number | null;
  readonly buyQuantity: number | null;
  readonly getQuantity: number | null;
  readonly stackable: boolean;
  readonly priority: number;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly customerRefs: readonly string[] | null;
  readonly segmentRefs: readonly string[] | null;
  readonly campaignRef: string | null;
  readonly usageLimit: number | null;
  readonly usageCount: number;
}

function toPromotionDto(promotion: Promotion): PromotionDto {
  return {
    id: promotion.id.toString(),
    name: promotion.name,
    status: promotion.status.value,
    ruleType: promotion.rule.type,
    scope: promotion.rule.condition.scope,
    targetRefs: promotion.rule.condition.targetRefs,
    minimumQuantity: promotion.rule.condition.minimumQuantity ?? null,
    minimumSubtotalAmountMinor: promotion.rule.condition.minimumSubtotalAmountMinor ?? null,
    rewardType: promotion.rule.reward.type,
    rewardValue: promotion.rule.reward.value ?? null,
    buyQuantity: promotion.rule.reward.buyQuantity ?? null,
    getQuantity: promotion.rule.reward.getQuantity ?? null,
    stackable: promotion.rule.stackable,
    priority: promotion.rule.priority,
    startsAt: promotion.schedule.startsAt.toISOString(),
    endsAt: promotion.schedule.endsAt?.toISOString() ?? null,
    customerRefs: promotion.eligibility.customerRefs ?? null,
    segmentRefs: promotion.eligibility.segmentRefs ?? null,
    campaignRef: promotion.campaign.campaignRef ?? null,
    usageLimit: promotion.usageLimit ?? null,
    usageCount: promotion.usageCount,
  };
}

const createPromotionBody = z.object({
  name: z.string().min(1),
  ruleType: z.enum(["automatic", "buy_x_get_y"]),
  scope: z.enum(["cart", "product", "category"]),
  targetRefs: z.array(z.string().min(1)),
  minimumQuantity: z.number().int().positive().optional(),
  minimumSubtotalAmountMinor: z.number().int().min(0).optional(),
  rewardType: z.enum(["percentage", "fixed_amount", "free_shipping"]),
  rewardValue: z.number().optional(),
  buyQuantity: z.number().int().positive().optional(),
  getQuantity: z.number().int().positive().optional(),
  stackable: z.boolean(),
  priority: z.number().int(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  customerRefs: z.array(z.string().min(1)).optional(),
  segmentRefs: z.array(z.string().min(1)).optional(),
  campaignRef: z.string().min(1).optional(),
  usageLimit: z.number().int().positive().optional(),
});
const promotionIdParams = z.object({ promotionId: z.string().min(1) });
const advancePromotionBody = z.object({
  toStatus: z.enum([
    "draft",
    "scheduled",
    "active",
    "paused",
    "expired",
    "depleted",
    "cancelled",
    "archived",
  ]),
});
const evaluatePromotionsBody = z.object({
  cart: z.object({
    lines: z.array(
      z.object({
        productRef: z.string().min(1),
        categoryRefs: z.array(z.string().min(1)),
        quantity: z.number().int().positive(),
        unitPriceAmountMinor: z.number().int().min(0),
      }),
    ),
    subtotalAmountMinor: z.number().int().min(0),
  }),
  customerRef: z.string().min(1),
  segmentRefs: z.array(z.string().min(1)).optional(),
});

/** The Promotions admin HTTP surface (Sprint S1). Pure delegation. */
export function promotionsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/promotions",
      version: 1,
      permission: "promotions:create",
      idempotent: true,
      summary: "Create a promotion",
      schema: { body: createPromotionBody },
      handle: ({ body, context }) =>
        admin.promotions.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/promotions/:promotionId/transitions",
      version: 1,
      permission: "promotions:advance",
      idempotent: true,
      summary: "Advance a promotion's status",
      schema: { params: promotionIdParams, body: advancePromotionBody },
      handle: ({ params, body, context }) =>
        admin.promotions.advance(context.principal, {
          tenantId: context.tenantId,
          promotionId: params.promotionId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/promotions/evaluate",
      version: 1,
      permission: "promotions:evaluate",
      summary: "Evaluate every active promotion against a cart snapshot (pure read)",
      schema: { body: evaluatePromotionsBody },
      handle: ({ body, context }) =>
        admin.promotions.evaluate(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/promotions/:promotionId/record-usage",
      version: 1,
      permission: "promotions:record_usage",
      summary: "Record one usage of a promotion",
      schema: { params: promotionIdParams },
      handle: ({ params, context }) =>
        admin.promotions.recordUsage(context.principal, {
          tenantId: context.tenantId,
          promotionId: params.promotionId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/promotions",
      version: 1,
      permission: "promotions:read",
      summary: "List promotions (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.promotions.list(context.principal, { ...query, tenantId: context.tenantId }),
          toPromotionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/promotions/:promotionId",
      version: 1,
      permission: "promotions:read",
      summary: "Get one promotion by id",
      schema: { params: promotionIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.promotions.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toPromotionDto(response.body as Promotion) };
      },
    }),
  ] as readonly RouteDefinition[];
}
