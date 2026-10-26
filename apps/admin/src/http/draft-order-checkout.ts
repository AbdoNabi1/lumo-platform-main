import type { CheckoutSession } from "@platform/checkout";
import {
  DEFAULT_DRAFT_DISCOUNT_TITLE,
  draftAmounts,
  draftRequirements,
  type DraftOrder,
} from "@platform/orders";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import {
  checkoutAddressOf,
  draftConflict,
  draftItemsOf,
  invalidResponse,
  withConflictCode,
} from "./draft-order-pricing";

type Materialised =
  | { readonly ok: true; readonly checkoutSessionId: string }
  | { readonly ok: false; readonly response: AdminResponse };

type SessionRead =
  | { readonly ok: true; readonly session: CheckoutSession | null }
  | { readonly ok: false; readonly response: AdminResponse };

const draftBusy = (): AdminResponse =>
  draftConflict("DRAFT_BUSY", "this draft order changed meanwhile; try again");

/**
 * Pre-flight 7 (Ruling 19): every 409 a draft route answers carries a draft code. A `CODE:` message
 * keeps its own (`DRAFT_COMPLETED`, `DRAFT_TOTAL_TOO_LARGE`, `DRAFT_LOCKED`, `VERSION_CONFLICT`,
 * `OUT_OF_STOCK`, …); a 409 with none — a session that changed or closed under the request — is
 * `DRAFT_BUSY`, which the merchant's screen and the storefront both read as "try again".
 */
export function withDraftConflictCode(response: AdminResponse): AdminResponse {
  const coded = withConflictCode(response);
  if (coded.status !== 409) return coded;
  const message = (coded.body as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" && /^[A-Z_]+:/.test(message) ? coded : draftBusy();
}

/**
 * The draft's current checkout session: null when it has none, Checkout no longer knows it, or it is
 * not THIS draft's (M-4, defence in depth: only `setDraftCheckout` with paired ids writes the ref) —
 * so another draft's order is never taken for this one's.
 */
export async function draftCheckoutOf(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: Pick<DraftOrder, "id" | "checkoutRef">,
): Promise<SessionRead> {
  if (draft.checkoutRef === null) return { ok: true, session: null };
  const response = await admin.publicReads.checkout.get({
    tenantId,
    checkoutSessionId: draft.checkoutRef,
  });
  if (response.status === 404) return { ok: true, session: null };
  if (response.status !== 200) return { ok: false, response };
  const session = response.body as CheckoutSession;
  return { ok: true, session: session.draftTerms?.draftOrderRef === draft.id ? session : null };
}

/**
 * Spec §4.6 decision / Ruling 10: a draft whose current checkout already became an order is completed
 * (Checkout's best-effort report may have failed). Idempotent; answers the draft as it now is — the
 * draft unchanged when anything could not be read or recorded.
 */
export async function healedDraft(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
): Promise<DraftOrder> {
  if (draft.status === "completed" || draft.checkoutRef === null) return draft;
  const current = await draftCheckoutOf(admin, tenantId, draft);
  const orderRef = current.ok ? (current.session?.orderRef ?? null) : null;
  if (orderRef === null) return draft;
  const recorded = await admin.publicReads.draftOrders.completeDraftFromCheckout({
    tenantId,
    draftId: draft.id,
    orderRef,
  });
  if (recorded.status !== 200) return draft;
  const reread = await admin.publicReads.draftOrders.getDraftOrder({ tenantId, draftId: draft.id });
  return reread.status === 200 ? (reread.body as DraftOrder) : draft;
}

/**
 * Why `SetDraftCheckout` did not apply. `applied: false` means the recorded session moved, the draft
 * was edited since it was read (its version changed), OR there is no live draft any more (completed
 * or deleted) — so the draft is read again rather than assumed.
 */
async function notRecorded(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draftId: string,
): Promise<AdminResponse> {
  const reread = await admin.publicReads.draftOrders.getDraftOrder({ tenantId, draftId });
  if (reread.status === 404) return reread;
  if (reread.status === 200 && (reread.body as DraftOrder).status === "completed") {
    return draftConflict("DRAFT_COMPLETED", "this draft order is already an order");
  }
  return draftBusy();
}

/**
 * Spec §4.5: the draft's checkout session. Reused when it is still open, was built from this very
 * version and carries no `manual` selection (unless `fresh` — the merchant's completion, Ruling 5);
 * otherwise a new one is built from the draft's STORED prices (Ruling 12) — Checkout validates it
 * completely before it expires the replaced one — then recorded with compare-and-set on the ref AND
 * the version it was built from (Ruling 3, Task 7 I-1). A checkout that already became an order is
 * never built past (409 DRAFT_COMPLETED; the caller heals). A lost race expires what it built.
 */
export async function materializeDraftCheckout(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  draft: DraftOrder,
  options: { readonly fresh: boolean },
): Promise<Materialised> {
  const missing = draftRequirements(draft.content(), "invoice");
  const shippingAddress = draft.shippingAddress;
  const shipping = draft.shipping;
  if (missing.length > 0 || shippingAddress === null || shipping === null) {
    return {
      ok: false,
      response: invalidResponse(
        "This draft order is not ready",
        missing.map((field) => ({ field, message: "required" })),
      ),
    };
  }
  const current = await draftCheckoutOf(admin, tenantId, draft);
  if (!current.ok) return current;
  if (current.session !== null && current.session.orderRef !== null) {
    return {
      ok: false,
      response: draftConflict("DRAFT_COMPLETED", "this draft order is already an order"),
    };
  }
  if (
    !options.fresh &&
    draft.checkoutRef !== null &&
    draft.checkoutVersion === draft.version &&
    current.session?.state.isOpen === true &&
    // Task 7 I-2: a session carrying the merchant's `manual` choice is never handed to a shopper.
    current.session.paymentSelection?.provider !== "manual"
  ) {
    return { ok: true, checkoutSessionId: draft.checkoutRef };
  }
  const amounts = draftAmounts(draft);
  const started = await admin.publicReads.checkout.startDraft({
    tenantId,
    draftOrderRef: draft.id,
    draftNumber: draft.draftNumber,
    ...(draft.customerRef === null ? {} : { customerRef: draft.customerRef }),
    currency: draft.currency,
    items: draftItemsOf(draft.lines, draft.currency),
    ...(draft.contactEmail === null ? {} : { contactEmail: draft.contactEmail }),
    shippingAddress: checkoutAddressOf(shippingAddress),
    billingAddress: checkoutAddressOf(draft.billingAddress ?? shippingAddress),
    ...(amounts.discountMinor === 0
      ? {}
      : {
          discount: {
            title: draft.discount?.reason ?? DEFAULT_DRAFT_DISCOUNT_TITLE,
            amountMinor: amounts.discountMinor,
          },
        }),
    shipping: { title: shipping.title, amountMinor: amounts.shippingMinor },
    ...(draft.checkoutRef === null ? {} : { replaces: draft.checkoutRef }),
  });
  if (started.status !== 201) return { ok: false, response: withDraftConflictCode(started) };
  const { checkoutSessionId } = started.body as { readonly checkoutSessionId: string };
  const recorded = await admin.publicReads.draftOrders.setDraftCheckout({
    tenantId,
    draftId: draft.id,
    checkoutRef: checkoutSessionId,
    checkoutVersion: draft.version,
    expectedCheckoutRef: draft.checkoutRef,
  });
  const applied =
    recorded.status === 200 && (recorded.body as { readonly applied: boolean }).applied;
  if (!applied) {
    await admin.publicReads.checkout.expire({ tenantId, checkoutSessionId });
    return { ok: false, response: await notRecorded(admin, tenantId, draft.id) };
  }
  return { ok: true, checkoutSessionId };
}

/**
 * Rulings 4 and 17: the draft's open checkout stops; a closed or vanished one is left alone. True when
 * nothing is open any more; false when Checkout could not be read or refused to expire it.
 */
export async function expireDraftCheckout(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  checkoutRef: string | null,
): Promise<boolean> {
  if (checkoutRef === null) return true;
  const response = await admin.publicReads.checkout.get({
    tenantId,
    checkoutSessionId: checkoutRef,
  });
  if (response.status === 404) return true;
  if (response.status !== 200) return false;
  const session = response.body as { readonly state: { readonly isOpen: boolean } };
  if (!session.state.isOpen) return true;
  const expired = await admin.publicReads.checkout.expire({
    tenantId,
    checkoutSessionId: checkoutRef,
  });
  return expired.status === 200;
}
