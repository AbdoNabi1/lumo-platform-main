import type { CheckoutSession } from "@platform/checkout";
import type { Principal } from "@platform/contracts";
import { draftRequirements, type DraftOrder, type Order } from "@platform/orders";
import type { PaymentIntent } from "@platform/payments";
import {
  BusinessRuleError,
  logger,
  NotFoundError,
  toErrorEnvelope,
  UnexpectedError,
  ValidationError,
} from "@platform/utils";
import type { WiredAdmin } from "../composition";
import {
  DraftCompletionNotRecorded,
  DraftOrderCompletionAdapter,
} from "../infrastructure/cross-context/draft-order-completion.adapter";
import type { AdminResponse } from "../interfaces/admin-response";
import {
  draftCheckoutOf,
  expireDraftCheckout,
  materializeDraftCheckout,
  withDraftConflictCode,
} from "./draft-order-checkout";
import { draftConflict, invalidResponse } from "./draft-order-pricing";

export type DraftPayment = "paid" | "collect_on_delivery";

const alreadyCompleted = (): AdminResponse =>
  draftConflict("ALREADY_COMPLETED", "this draft order is already an order");

/** Spec §4.6 step 1: Mark as paid → the staff-recorded `manual` provider; Collect on delivery → `cod`. */
const providerOf = (payment: DraftPayment): "manual" | "cod" =>
  payment === "paid" ? "manual" : "cod";

const paymentNotRecorded = (message: string): AdminResponse =>
  draftConflict("PAYMENT_NOT_RECORDED", message);

/**
 * Spec §4.6 step 5, explicit after the merchant's completion (Checkout's own report is best effort):
 * Orders marks the draft completed by `orderRef`. Answers null once recorded (also when it already
 * was, by this order), else the response to return. Orders' answers are sorted by the completion
 * adapter (Ruling 12) — never by their wording: another order holds the draft → 409
 * ALREADY_COMPLETED; the draft is gone → 404; the order is not visible yet, or anything else → 503,
 * the draft stays open and a retry (a new submit: this answer is cached under its idempotency key)
 * resumes this very order.
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

/**
 * Spec §4.6 steps 3–4, both idempotent: open the payment through Checkout's `InitiatePayment` on the
 * draft's own session (the order → payment_requested; Payments serves `manual` only because staff
 * initiate it on a session with draft terms), and for "paid" settle the `manual` intent through the
 * confirmed collection with the intent's OWN amount (never a client figure). A failure answers 409
 * PAYMENT_NOT_RECORDED; a retry — a new submit, since the route caches this answer under its
 * idempotency key — resumes (Ruling 6).
 */
async function finishPayment(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  checkoutSessionId: string,
  orderRef: string,
  payment: DraftPayment,
): Promise<AdminResponse> {
  let initiated: AdminResponse;
  try {
    initiated = await admin.publicReads.checkout.initiatePayment({
      tenantId,
      checkoutSessionId,
      // This route is staff-only (authorizeCompletion), so it may open the `manual` payment.
      initiatedByStaff: true,
    });
  } catch (error) {
    // Only Payments' refusal, as the initiation adapter throws it (its 422 / 409), is answered: the
    // order stands and a new submit resumes. Anything else is a fault and is not hidden.
    if (!(error instanceof ValidationError || error instanceof BusinessRuleError)) throw error;
    logger.warn("draft order payment could not be opened", {
      tenantId,
      orderRef,
      error: error.message,
    });
    initiated = { status: 503, body: null };
  }
  if (initiated.status < 200 || initiated.status >= 300) {
    return paymentNotRecorded("the order exists but its payment could not be opened; try again");
  }
  const { paymentIntentId } = initiated.body as { readonly paymentIntentId: string };
  if (payment === "paid") {
    const read = await admin.payments.getPaymentIntent(principal, { tenantId, paymentIntentId });
    if (read.status !== 200) return paymentNotRecorded("the payment could not be read; try again");
    const intent = read.body as PaymentIntent;
    if (intent.status.value !== "captured") {
      const settled = await admin.payments.confirmCodCollection(principal, {
        tenantId,
        paymentIntentId,
        collectedAmountMinor: intent.amount.amountMinor,
        currency: intent.amount.currency,
      });
      if (settled.status !== 200) {
        return paymentNotRecorded("the order exists but the payment was not recorded; try again");
      }
    }
  }
  const order = await admin.orders.getOrder(principal, { tenantId, orderId: orderRef });
  const orderNumber = order.status === 200 ? (order.body as Order).orderNumber.value : null;
  return { status: 200, body: { orderId: orderRef, orderNumber } };
}

/**
 * Ruling 6: the draft's checkout already became an order — the draft completed, or (Ruling 5) its
 * session did and Orders was not told yet, which is recorded now. The same payment method finishes
 * the payment steps and answers that order; anything else is 409 ALREADY_COMPLETED. Never a second
 * order.
 */
async function resumeCompletion(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  draft: DraftOrder,
  placed: CheckoutSession | null,
  payment: DraftPayment,
): Promise<AdminResponse> {
  const orderRef = placed?.orderRef ?? null;
  if (placed === null || orderRef === null) return alreadyCompleted();
  if (draft.orderRef !== null && draft.orderRef !== orderRef) return alreadyCompleted();
  if (draft.status !== "completed") {
    const unrecorded = await recordDraftCompletion(admin, principal, tenantId, {
      draftId: draft.id,
      orderRef,
    });
    if (unrecorded !== null) return unrecorded;
  }
  if (placed.paymentSelection?.provider !== providerOf(payment)) return alreadyCompleted();
  return finishPayment(admin, principal, tenantId, placed.id.toString(), orderRef, payment);
}

/**
 * Spec §4.6: create the order from a draft — Mark as paid (manual payment) or Collect on delivery
 * (COD). Resumes, never places a second order, when the draft's checkout already became one.
 */
export async function completeDraft(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  draftId: string,
  payment: DraftPayment,
): Promise<AdminResponse> {
  const denied = await admin.draftOrders.authorizeCompletion(principal, payment);
  if (denied !== null) return denied;
  const found = await admin.draftOrders.get(principal, { tenantId, draftId });
  if (found.status !== 200) return found;
  const draft = found.body as DraftOrder;
  const current = await draftCheckoutOf(admin, tenantId, draft);
  if (!current.ok) return current.response;
  if (draft.status === "completed" || current.session?.orderRef != null) {
    return resumeCompletion(admin, principal, tenantId, draft, current.session, payment);
  }

  const missing = draftRequirements(draft.content(), "complete");
  if (missing.length > 0) {
    return invalidResponse(
      "This draft order is not ready",
      missing.map((field) => ({ field, message: "required" })),
    );
  }
  if (payment === "collect_on_delivery") {
    // Ruling 7: refused before anything is built — the merchant's own payment settings decide.
    const offered = await admin.publicReads.checkout.listPaymentMethods({ tenantId });
    const methods =
      offered.status === 200
        ? (offered.body as { readonly methods: readonly string[] }).methods
        : [];
    if (!methods.includes("cod")) {
      return draftConflict("COD_NOT_ENABLED", "turn on cash on delivery in Settings → Payments");
    }
  }
  // Ruling 5: always a fresh session; Checkout expires the open one (a customer's invoice
  // checkout) in the same unit of work, only once the new one is complete.
  const built = await materializeDraftCheckout(admin, tenantId, draft, { fresh: true });
  if (!built.ok) return built.response;
  const { checkoutSessionId } = built;
  // Task 7 I-2: a session this route built and could not turn into an order is closed before the
  // refusal is answered — it carries the merchant's payment choice (`manual` for Mark as paid) and
  // must never be handed to a shopper by the invoice claim.
  const refused = async (response: AdminResponse): Promise<AdminResponse> => {
    if (!(await expireDraftCheckout(admin, tenantId, checkoutSessionId))) {
      logger.warn("draft order completion failed and its checkout could not be closed", {
        tenantId,
        draftId: draft.id,
      });
    }
    return withDraftConflictCode(response);
  };
  const selected = await admin.publicReads.checkout.selectDraftPayment({
    tenantId,
    checkoutSessionId,
    provider: providerOf(payment),
  });
  if (selected.status !== 200) return refused(selected);
  const completed = await admin.publicReads.checkout.complete({
    tenantId,
    checkoutSessionId,
    idempotencyKey: `draft:${draft.id}:${draft.version}`,
    actorRef: principal.id,
  });
  if (completed.status !== 200) return refused(completed);
  const { orderRef } = completed.body as { readonly orderRef: string };
  // Explicit and idempotent: the report inside CompleteCheckout is best effort.
  const unrecorded = await recordDraftCompletion(admin, principal, tenantId, {
    draftId: draft.id,
    orderRef,
  });
  if (unrecorded !== null) return unrecorded;
  return finishPayment(admin, principal, tenantId, checkoutSessionId, orderRef, payment);
}
