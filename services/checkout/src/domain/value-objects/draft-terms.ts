/**
 * Order operations Part 4 — what a merchant fixed on a draft order's checkout (spec §4.4): the price is
 * final, so the discount and the shipping are set here and never re-evaluated. Plain data so Checkout
 * imports nothing from Orders.
 */
export interface DraftTerms {
  /** The draft order's id (bare reference into Orders). */
  readonly draftOrderRef: string;
  /** "D3" — shown on the storefront ("Invoice #D3"). */
  readonly draftNumber: string;
  readonly discount?: { readonly title: string; readonly amountMinor: number };
  readonly shipping: { readonly title: string; readonly amountMinor: number };
}

/** The 409 code the public routes answer when a shopper tries to change what the merchant fixed. */
export const DRAFT_LOCKED = "DRAFT_LOCKED";
/** The shipping method recorded on a draft session (snapshotted onto the order). */
export const DRAFT_SHIPPING_METHOD = "draft";

/** The discount entry's `promotionId` — `DiscountUsageAdapter` skips it (no promotion to count). */
export function draftPromotionId(draftOrderRef: string): string {
  return `draft:${draftOrderRef}`;
}

export function isDraftPromotionId(promotionId: string): boolean {
  return promotionId.startsWith("draft:");
}

/** Ruling 1: a draft session has no cart row; its `cartRef` names the draft. */
export function draftCartRef(draftOrderRef: string): string {
  return `draft:${draftOrderRef}`;
}
