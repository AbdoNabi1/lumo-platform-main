import type { CheckoutSession } from "@platform/checkout";
import type { Principal } from "@platform/contracts";
import {
  DEFAULT_DRAFT_DISCOUNT_TITLE,
  draftAmounts,
  draftRequirements,
  type DraftOrder,
} from "@platform/orders";
import { logger, NotFoundError, toErrorEnvelope, UnexpectedError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import {
  DraftCompletionNotRecorded,
  DraftOrderCompletionAdapter,
} from "../infrastructure/cross-context/draft-order-completion.adapter";
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

/** The draft's current checkout session: null when it has none or Checkout no longer knows it. */
export async function draftCheckoutOf(
  admin: Pick<WiredAdmin, "publicReads">,
  tenantId: string,
  checkoutRef: string | null,
): Promise<SessionRead> {
  if (checkoutRef === null) return { ok: true, session: null };
  const response = await admin.publicReads.checkout.get({
    tenantId,
    checkoutSessionId: checkoutRef,
  });
  if (response.status === 404) return { ok: true, session: null };
  if (response.status !== 200) return { ok: false, response };
  return { ok: true, session: response.body as CheckoutSession };
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
  const current = await draftCheckoutOf(admin, tenantId, draft.checkoutRef);
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
 * Why `SetDraftCheckout` did not apply. `applied: false` means the recorded session moved OR there is
 * no live draft any more (completed or deleted) — so the draft is read again rather than assumed.
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
 * Spec §4.5: the draft's checkout session. Reused when it is still open and was built from this very
 * version (unless `fresh` — the merchant's completion, Ruling 5); otherwise a new one is built from the
 * draft's STORED prices (Ruling 12) — Checkout validates it completely before it expires the replaced
 * one — then recorded with compare-and-set (Ruling 3). A checkout that already became an order is
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
  const current = await draftCheckoutOf(admin, tenantId, draft.checkoutRef);
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
    current.session?.state.isOpen === true
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
 * Spec §4.6 step 5, explicit after the merchant's completion (Checkout's own report is best effort):
 * Orders marks the draft completed by `orderRef`. Answers null once recorded (also when it already
 * was, by this order), else the response to return. Orders' answers are sorted by the completion
 * adapter (Ruling 12) — never by their wording: another order holds the draft → 409
 * ALREADY_COMPLETED; the draft is gone → 404; the order is not visible yet, or anything else → 503,
 * the draft stays open and the same request resumes this very order.
 */
export async function recordDraftCompletion(
  admin: Pick<WiredAdmin, "publicReads" | "orders">,
  principal: Principal,
  tenantId: string,
  completion: { readonly draftId: string; readonly orderRef: string },
): Promise<AdminResponse | null> {
  const recorder = new DraftOrderCompletionAdapter({
    completeDraftFromCheckout: (input) =>
      admin.publicReads.draftOrders.completeDraftFromCheckout(input),
    getDraftOrder: (input) => admin.publicReads.draftOrders.getDraftOrder(input),
    getOrder: (input) => admin.orders.getOrder(principal, input),
  });
  try {
    await recorder.complete({
      tenantId,
      draftOrderRef: completion.draftId,
      orderRef: completion.orderRef,
      actorRef: principal.id,
    });
    return null;
  } catch (error) {
    if (!(error instanceof DraftCompletionNotRecorded)) throw error;
    logger.warn("the draft order's completion was not recorded", {
      tenantId,
      draftId: completion.draftId,
      orderRef: completion.orderRef,
      failure: error.failure,
      error: error.message,
    });
    if (error.failure === "completed_by_another_order") {
      return draftConflict(
        "ALREADY_COMPLETED",
        "another order completed this draft order meanwhile",
      );
    }
    if (error.failure === "draft_missing") {
      return { status: 404, body: toErrorEnvelope(new NotFoundError("Draft order not found")) };
    }
    return {
      status: 503,
      body: toErrorEnvelope(
        new UnexpectedError(
          "The order was placed but the draft order is not updated yet. Try again.",
        ),
      ),
    };
  }
}
