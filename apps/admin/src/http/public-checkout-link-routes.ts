import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Cart } from "@platform/cart";
import {
  LINK_INVALID,
  type CheckoutSession,
  type ResolveCheckoutLinkOutput,
  type StartRecoveredCheckoutOutput,
} from "@platform/checkout";
import { BusinessRuleError, NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { resolveMerchandise, type MerchandiseResolution } from "./merchandise-resolution";
import { lineKey, resolveLineImages } from "./product-images";
import { checkoutItemsOf } from "./public-checkout-routes";
import { shopNameOf } from "./shop-link-url";

const token = z.string().min(1).max(128);
/** `.strict()`: a claim carries the bearer token and the caller's own session — never a price. */
const claimBody = z.object({ token, sessionRef: z.string().min(1) }).strict();
const tokenParams = z.object({ token });

export interface CheckoutLinkClaimDto {
  /** The CALLER's new (or resumed) checkout — never the abandoned one. */
  readonly checkoutSessionId: string;
  readonly droppedItems: number;
}

export interface CheckoutLinkPreviewDto {
  readonly purpose: "recovery";
  readonly shopName: string;
  readonly itemCount: number;
  readonly items: readonly {
    readonly title: string | null;
    readonly variantTitle: string | null;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  /** The lines at the prices they were left at; the checkout re-prices them (spec §3.5). */
  readonly totalMinor: number;
  readonly currency: string;
}

const isOk = (response: AdminResponse): boolean => response.status >= 200 && response.status < 300;

/** Every link that cannot be used — unknown, expired, revoked, another shop's, spent — answers this. */
export function linkInvalidResponse(): AdminResponse {
  return {
    status: 404,
    body: {
      ...toErrorEnvelope(new NotFoundError("This link has expired or is no longer valid")),
      code: LINK_INVALID,
    },
  };
}

function itemsUnavailableResponse(): AdminResponse {
  return {
    status: 409,
    body: {
      ...toErrorEnvelope(
        new BusinessRuleError("None of this checkout's items can be sold any more"),
      ),
      code: "ITEMS_UNAVAILABLE",
    },
  };
}

async function resolve(
  admin: WiredAdmin,
  tenantId: string,
  value: string,
): Promise<ResolveCheckoutLinkOutput | null> {
  const resolved = await admin.publicReads.checkout.resolveLink({ tenantId, token: value });
  return resolved.status === 200 ? (resolved.body as ResolveCheckoutLinkOutput) : null;
}

/** Spec §3.5 step 2: the session the last claim made, if it is still open AND the caller's own. */
async function reusableResult(
  admin: WiredAdmin,
  tenantId: string,
  resultRef: string | null,
  sessionRef: string,
): Promise<string | null> {
  if (resultRef === null) return null;
  const response = await admin.publicReads.checkout.get({ tenantId, checkoutSessionId: resultRef });
  if (response.status !== 200) return null;
  const session = response.body as CheckoutSession;
  return session.sessionRef === sessionRef && session.state.isOpen ? resultRef : null;
}

type Priced = Extract<MerchandiseResolution, { status: "ok" }> & { readonly quantity: number };

/** Each abandoned line priced from Catalog NOW (never the snapshot); unsellable lines are counted. */
async function priceLines(
  admin: WiredAdmin,
  tenantId: string,
  abandoned: CheckoutSession,
): Promise<{ readonly priced: readonly Priced[]; readonly dropped: number }> {
  const priced: Priced[] = [];
  let dropped = 0;
  for (const line of abandoned.items) {
    const merchandise = await resolveMerchandise(
      admin,
      {
        productId: line.productRef,
        ...(line.variantRef === undefined ? {} : { variantId: line.variantRef }),
      },
      tenantId,
    );
    if (merchandise.status === "ok") priced.push({ ...merchandise, quantity: line.quantity });
    else dropped += 1;
  }
  return { priced, dropped };
}

/** The caller's current cart (created when there is none), emptied: Shopify's recovery replaces it. */
async function emptiedCart(
  admin: WiredAdmin,
  tenantId: string,
  sessionRef: string,
  currency: string,
): Promise<Cart | AdminResponse> {
  const current = await admin.publicReads.cart.getCurrent({ tenantId, sessionRef });
  if (!isOk(current)) return current;
  let cart = current.body as Cart | null;
  if (cart === null) {
    const created = await admin.publicReads.cart.create({ tenantId, sessionRef, currency });
    if (!isOk(created)) return created;
    const read = await admin.publicReads.cart.get({
      tenantId,
      cartId: (created.body as { readonly cartId: string }).cartId,
    });
    if (!isOk(read)) return read;
    cart = read.body as Cart;
  }
  if (cart.items.length > 0) {
    const cleared = await admin.publicReads.cart.clear({ tenantId, cartId: cart.id.toString() });
    if (!isOk(cleared)) return cleared;
  }
  return cart;
}

/**
 * Order operations Part 3 — the shopper's side of a recovery link (spec §3.5). Public like the
 * checkout routes; the token is the bearer proof for "resume this checkout", and the caller's
 * `sessionRef` (their own HttpOnly cookie, sent by the storefront's server) owns whatever is made.
 *
 * The claim CLONES: the abandoned session — and its owner's `sessionRef` — is never handed over or
 * echoed. Lines are re-priced from Catalog; the claim happens only on this POST (the storefront's
 * button), never on the preview GET that link-preview bots fetch.
 */
export function publicCheckoutLinkRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/public/checkout-links/claim",
      version: 1,
      permission: "checkout:start",
      public: true,
      summary:
        "Public: open a recovery link — clones its checkout into the caller's own, at today's prices",
      schema: { body: claimBody },
      handle: async ({ body, context }) => {
        const tenantId = context.tenantId;
        const resolved = await resolve(admin, tenantId, body.token);
        if (resolved === null) return linkInvalidResponse();

        const reused = await reusableResult(
          admin,
          tenantId,
          resolved.link.resultCheckoutRef,
          body.sessionRef,
        );
        if (reused !== null) {
          const dto: CheckoutLinkClaimDto = { checkoutSessionId: reused, droppedItems: 0 };
          return { status: 200, body: dto };
        }

        // Priced BEFORE the caller's cart is touched: nothing sellable leaves it as it was.
        const abandoned = resolved.session;
        const { priced, dropped } = await priceLines(admin, tenantId, abandoned);
        if (priced.length === 0) return itemsUnavailableResponse();

        const cart = await emptiedCart(admin, tenantId, body.sessionRef, abandoned.currency);
        if (!("items" in cart)) return cart;
        const cartId = cart.id.toString();
        let kept = 0;
        let droppedItems = dropped;
        for (const line of priced) {
          const added =
            line.currency === cart.currency
              ? await admin.publicReads.cart.add({
                  tenantId,
                  cartId,
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPriceAmountMinor: line.amountMinor,
                  currency: line.currency,
                  merchandise: {
                    variantRef: line.variantId,
                    sku: line.sku,
                    title: line.title,
                    variantTitle: line.variantTitle,
                  },
                })
              : null;
          if (added !== null && isOk(added)) kept += 1;
          else droppedItems += 1;
        }
        if (kept === 0) return itemsUnavailableResponse();

        const refilled = await admin.publicReads.cart.get({ tenantId, cartId });
        if (!isOk(refilled)) return refilled;
        // One unit of work: the guarded claim count first, then the clone only if it applied — a
        // link that expired or was revoked since it resolved never leaves an orphan checkout.
        // Contact and address are copied; shipping/payment and discount codes are re-chosen.
        const started = await admin.publicReads.checkout.startRecovered({
          tenantId,
          linkId: resolved.link.id,
          cartRef: cartId,
          sessionRef: body.sessionRef,
          currency: cart.currency,
          items: checkoutItemsOf(refilled.body as Cart),
        });
        if (started.status === 404) return linkInvalidResponse();
        if (!isOk(started)) return started;
        const { checkoutSessionId } = started.body as StartRecoveredCheckoutOutput;
        const dto: CheckoutLinkClaimDto = { checkoutSessionId, droppedItems };
        return { status: 200, body: dto };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/checkout-links/:token/preview",
      version: 1,
      permission: "checkout:read",
      public: true,
      summary:
        "Public: what a recovery link holds (shop, items, total) — no personal data, claims nothing",
      schema: { params: tokenParams },
      handle: async ({ params, context }) => {
        const resolved = await resolve(admin, context.tenantId, params.token);
        if (resolved === null) return linkInvalidResponse();
        const { session } = resolved;
        const images = await resolveLineImages(
          admin,
          context.tenantId,
          session.items.map((item) => ({
            productId: item.productRef,
            variantId: item.variantRef ?? null,
          })),
        );
        const dto: CheckoutLinkPreviewDto = {
          purpose: "recovery",
          shopName: await shopNameOf(admin),
          itemCount: session.items.reduce((count, item) => count + item.quantity, 0),
          items: session.items.map((item) => ({
            title: item.title ?? null,
            variantTitle: item.variantTitle ?? null,
            quantity: item.quantity,
            imageUrl: images.get(lineKey(item.productRef, item.variantRef ?? null))?.url ?? null,
          })),
          totalMinor: session.items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
          currency: session.currency,
        };
        return { status: 200, body: dto };
      },
    }),
  ] as readonly RouteDefinition[];
}
