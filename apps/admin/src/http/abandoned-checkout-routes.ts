import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  ABANDONED_PAGE_SIZE_MAX,
  RECOVERY_FILTERS,
  type GetAbandonedCheckoutOutput,
  type IssueRecoveryLinkOutput,
  type ListAbandonedCheckoutsOutput,
} from "@platform/checkout";
import type { Order } from "@platform/orders";
import type { WiredAdmin } from "../composition";
import {
  recoveredOrderOf,
  toAbandonedDetailDto,
  toAbandonedListItemDto,
  type RecoveryLinkDto,
} from "./abandoned-checkout-dto";
import { withLineImages } from "./product-images";
import { primaryHostnameOf, shopLinkUrl, shopNameOf } from "./shop-link-url";

const listQuery = z.object({
  first: z.coerce.number().int().min(1).max(ABANDONED_PAGE_SIZE_MAX).optional(),
  after: z.string().min(1).max(64).optional(),
  q: z.string().max(200).optional(),
  recovery: z.enum(RECOVERY_FILTERS).optional(),
});
const idParams = z.object({ checkoutSessionId: z.string().min(1).max(64) });

/** The recovered rows' order numbers in ONE `orders:read` read (at most 50 ids — Part 1's cap). */
async function orderNumbersOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Map();
  const response = await admin.orders.listOrders(principal, { tenantId, ids, first: ids.length });
  if (response.status !== 200) return new Map();
  const page = response.body as { readonly items: readonly Order[] };
  return new Map(page.items.map((order) => [order.id.toString(), order.orderNumber.value]));
}

const recoveredRefs = (sessions: readonly { readonly recoveredOrderRef?: string }[]): string[] =>
  sessions.flatMap((s) => (s.recoveredOrderRef === undefined ? [] : [s.recoveredOrderRef]));

/** Order operations Part 3 — the staff side of abandoned checkouts (spec §3.6). */
export function abandonedCheckoutRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return withLineImages(admin, [
    defineRoute({
      method: "GET",
      path: "/abandoned-checkouts",
      version: 1,
      permission: "orders:read",
      summary:
        "Abandoned checkouts (idle an hour with an email or phone) and recovered ones, newest first",
      schema: { querystring: listQuery },
      handle: async ({ query, context }) => {
        const response = await admin.checkout.listAbandoned(context.principal, {
          tenantId: context.tenantId,
          first: query.first,
          after: query.after,
          search: query.q,
          recovery: query.recovery,
        });
        if (response.status !== 200) return response;
        const page = response.body as ListAbandonedCheckoutsOutput;
        const numbers = await orderNumbersOf(
          admin,
          context.principal,
          context.tenantId,
          recoveredRefs(page.items.map((entry) => entry.record.session)),
        );
        return {
          status: 200,
          body: {
            items: page.items.map((entry) =>
              toAbandonedListItemDto(entry.record, {
                lastLinkIssuedAt: entry.lastLinkIssuedAt,
                recoveredOrder: recoveredOrderOf(entry.record.session, numbers),
              }),
            ),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/abandoned-checkouts/:checkoutSessionId",
      version: 1,
      permission: "orders:read",
      summary: "One abandoned checkout: lines, totals, contact, address and its recovery links",
      schema: { params: idParams },
      handle: async ({ params, context }) => {
        const response = await admin.checkout.getAbandoned(context.principal, {
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
        });
        if (response.status !== 200) return response;
        const found = response.body as GetAbandonedCheckoutOutput;
        const numbers = await orderNumbersOf(
          admin,
          context.principal,
          context.tenantId,
          recoveredRefs([found.record.session]),
        );
        return {
          status: 200,
          body: toAbandonedDetailDto(
            found.record,
            found.links,
            recoveredOrderOf(found.record.session, numbers),
          ),
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/abandoned-checkouts/:checkoutSessionId/recovery-link",
      version: 1,
      permission: "orders:recover_checkout",
      // NOT idempotent: every call mints a new token by design, and the idempotency response cache
      // would otherwise keep the plaintext token (which is stored nowhere else) for 24 hours.
      summary:
        "Issue a new 7-day recovery link for an abandoned checkout (the token is shown once)",
      schema: { params: idParams },
      handle: async ({ params, context }) => {
        const issued = await admin.checkout.issueRecoveryLink(context.principal, {
          tenantId: context.tenantId,
          checkoutSessionId: params.checkoutSessionId,
          createdBy: context.principal.id,
        });
        if (issued.status !== 201) return issued;
        const { token, expiresAt } = issued.body as IssueRecoveryLinkOutput;
        const path = `/c/${token}`;
        const hostname = primaryHostnameOf(await admin.shopDomains(context.tenantId));
        const body: RecoveryLinkDto = {
          url: shopLinkUrl(hostname, path),
          path,
          expiresAt,
          shopName: await shopNameOf(admin),
        };
        return { status: 201, body };
      },
    }),
  ] as readonly RouteDefinition[]);
}
