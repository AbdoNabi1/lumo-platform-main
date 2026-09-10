import { defineRoute, type RouteDefinition } from "@platform/http";
import type { LoyaltyAccount } from "@platform/loyalty";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";
import { resolveCustomerSessionId } from "./public-auth-routes";

/**
 * The **customer's own loyalty balance** surface (T5.19) — one more read built on the customer
 * authentication foundation T5.17 established, following `public-wishlist-routes.ts`'s exact
 * pattern but much smaller: a single read, no mutations. Earning, spending, cashback, redemption,
 * and referral bonuses stay admin/system-triggered (`loyalty-routes.ts`) — nothing a customer does
 * directly by clicking a button on their own account page.
 *
 * Reaches the domain through `admin.publicReads.loyalty` (the raw, unguarded `LoyaltyController`)
 * rather than the guarded `LoyaltyAdminController` — the same reasoning `public-wishlist-routes.ts`
 * documents for Wishlist: calling the guarded controller would require fabricating a `Principal`,
 * which silently allows everything under `AllowAllAccessControl` and silently denies everything
 * under Keto.
 *
 * ── The one rule this whole file exists to enforce ──
 * **The `customerRef` is ALWAYS the session's.** No schema below has a `customerRef` or `accountId`
 * field at all — the account is always resolved from the session's `customerRef` via
 * `getByCustomer`, so there is no id for a caller to tamper with.
 *
 * ── No account yet is not an error to paper over ──
 * Unlike Wishlist (created on first access), a loyalty account is opened by an admin/system action
 * (`loyalty:open`, e.g. triggered by a customer's first purchase) — a customer does not self-open
 * one by visiting a page. A customer with no account yet gets a clean 404, never a fabricated
 * zero-balance account (Global constraint 3).
 */

export interface PublicLoyaltyTransactionDto {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly pointsDelta: number;
  readonly ref: string | null;
  readonly occurredAt: string;
}

/**
 * The customer's own loyalty account projection. `customerRef` is deliberately omitted — same
 * reasoning as `PublicWishlistDto`/`PublicCartDto`: the caller cannot be anyone else here, so
 * echoing their own id back serves no rendering need, and a DTO that never carries it cannot leak
 * it into a log, a cache key, or a client-side store that later gets sent back as input.
 */
export interface PublicLoyaltyAccountDto {
  readonly id: string;
  readonly status: string;
  readonly balance: number;
  readonly tierName: string;
  readonly transactions: readonly PublicLoyaltyTransactionDto[];
}

function toPublicLoyaltyAccountDto(account: LoyaltyAccount): PublicLoyaltyAccountDto {
  return {
    id: account.id.toString(),
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

export function publicLoyaltyRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/loyalty/accounts/me",
      version: 1,
      permission: "loyalty:read",
      public: true,
      summary: "Public: the signed-in customer's own loyalty balance (404 if none exists yet)",
      schema: {},
      handle: async ({ context }): Promise<PageResponse> => {
        const guarded = await admin.customerAuth.requireSession(resolveCustomerSessionId(context));
        if (!guarded.ok) return guarded.response;

        const response = await admin.publicReads.loyalty.getByCustomer({
          customerRef: guarded.session.customerRef,
          tenantId: context.tenantId,
        });
        if (response.status < 200 || response.status >= 300) return response;
        return { status: 200, body: toPublicLoyaltyAccountDto(response.body as LoyaltyAccount) };
      },
    }),
  ] as readonly RouteDefinition[];
}
