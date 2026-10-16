import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { LoyaltyAccount } from "@platform/loyalty";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const openAccountBody = z.object({ customerRef: z.string().min(1) });
const accountIdParams = z.object({ accountId: z.string().min(1) });

export interface LoyaltyTransactionDto {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly pointsDelta: number;
  readonly ref: string | null;
  readonly occurredAt: string;
}

export interface LoyaltyAccountDto {
  readonly id: string;
  readonly customerRef: string;
  readonly status: string;
  readonly balance: number;
  readonly tierName: string;
  readonly transactions: readonly LoyaltyTransactionDto[];
}

function toLoyaltyAccountDto(account: LoyaltyAccount): LoyaltyAccountDto {
  return {
    id: account.id.toString(),
    customerRef: account.customerRef,
    status: account.status.value,
    balance: account.points.balance,
    tierName: account.tierName,
    transactions: account.transactions.map((t) => ({
      id: t.id.toString(),
      idempotencyKey: t.idempotencyKey,
      kind: t.kind,
      pointsDelta: t.pointsDelta,
      ref: t.ref ?? null,
      occurredAt: t.occurredAt.toISOString(),
    })),
  };
}
const advanceAccountBody = z.object({
  toStatus: z.enum(["active", "suspended", "closed"]),
});
const ledgerBody = z.object({
  idempotencyKey: z.string().min(1),
  points: z.number(),
  ref: z.string().min(1),
});
const redeemRewardBody = z.object({
  idempotencyKey: z.string().min(1),
  rewardRef: z.string().min(1),
  rewardName: z.string().min(1),
  costPoints: z.number(),
});
const completeReferralBody = z.object({
  idempotencyKey: z.string().min(1),
  bonusPoints: z.number(),
  referredCustomerRef: z.string().min(1),
});

/** The Loyalty admin HTTP surface (Sprint S1). Pure delegation. */
export function loyaltyRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts",
      version: 1,
      permission: "loyalty:open",
      idempotent: true,
      summary: "Open a loyalty account for a customer",
      schema: { body: openAccountBody },
      handle: ({ body, context }) =>
        admin.loyalty.open(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/transitions",
      version: 1,
      permission: "loyalty:advance",
      idempotent: true,
      summary: "Advance an account's status (suspend/reactivate/close)",
      schema: { params: accountIdParams, body: advanceAccountBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.advance(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/earn",
      version: 1,
      permission: "loyalty:earn",
      idempotent: true,
      summary: "Earn points (idempotent by idempotencyKey)",
      schema: { params: accountIdParams, body: ledgerBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.earn(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/spend",
      version: 1,
      permission: "loyalty:spend",
      idempotent: true,
      summary: "Spend points (idempotent by idempotencyKey)",
      schema: { params: accountIdParams, body: ledgerBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.spend(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/cashback",
      version: 1,
      permission: "loyalty:cashback",
      idempotent: true,
      summary: "Record a cashback earning (idempotent by idempotencyKey)",
      schema: { params: accountIdParams, body: ledgerBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.cashback(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/redeem",
      version: 1,
      permission: "loyalty:redeem",
      idempotent: true,
      summary: "Redeem a catalog reward for points (idempotent by idempotencyKey)",
      schema: { params: accountIdParams, body: redeemRewardBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.redeem(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/loyalty/accounts/:accountId/referral",
      version: 1,
      permission: "loyalty:referral",
      idempotent: true,
      summary: "Complete a referral bonus (idempotent by idempotencyKey)",
      schema: { params: accountIdParams, body: completeReferralBody },
      handle: ({ params, body, context }) =>
        admin.loyalty.referral(context.principal, {
          accountId: params.accountId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/loyalty/accounts",
      version: 1,
      permission: "loyalty:read",
      summary: "List loyalty accounts (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.loyalty.list(context.principal, { ...query, tenantId: context.tenantId }),
          toLoyaltyAccountDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/loyalty/accounts/:accountId",
      version: 1,
      permission: "loyalty:read",
      summary: "Get one loyalty account by id — the points balance is the whole point",
      schema: { params: accountIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.loyalty.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toLoyaltyAccountDto(response.body as LoyaltyAccount) };
      },
    }),
  ] as readonly RouteDefinition[];
}
