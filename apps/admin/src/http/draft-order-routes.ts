import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { CheckoutLink, CheckoutSession, IssueInvoiceLinkOutput } from "@platform/checkout";
import type { CustomerContact } from "@platform/identity";
import {
  DRAFT_ORDER_STATUSES,
  DRAFT_PAGE_SIZE_MAX,
  draftRequirements,
  type DraftOrder,
  type DraftOrderOutput,
  type DraftOrderPage,
  type Order,
} from "@platform/orders";
import type { PaymentIntent } from "@platform/payments";
import { logger, toErrorEnvelope, UnexpectedError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import {
  draftCheckoutOf,
  healedDraft,
  materializeDraftCheckout,
  recordDraftCompletion,
  withDraftConflictCode,
} from "./draft-order-checkout";
import { toDraftListItemDto, toDraftOrderDto, type DraftOrderDto } from "./draft-order-dto";
import {
  draftBody,
  draftConflict,
  draftContentFrom,
  draftRateQuotes,
  estimatedTaxOf,
  invalidResponse,
  storeCurrencyOf,
  withConflictCode,
} from "./draft-order-pricing";
import { resolveLineImages } from "./product-images";
import { primaryHostnameOf, shopLinkUrl, shopNameOf } from "./shop-link-url";

const listQuery = z.object({
  status: z.enum(DRAFT_ORDER_STATUSES).optional(),
  q: z.string().max(200).optional(),
  first: z.coerce.number().int().min(1).max(DRAFT_PAGE_SIZE_MAX).optional(),
  after: z.string().min(1).max(64).optional(),
});
export const draftIdParams = z.object({ draftId: z.string().min(1).max(64) });
const updateBody = draftBody.extend({ version: z.number().int().min(0) }).strict();

function currencyUnavailable(): AdminResponse {
  return {
    status: 503,
    body: toErrorEnvelope(new UnexpectedError("The shop's currency is unavailable")),
  };
}

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

async function contactsOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  customerIds: readonly string[],
): Promise<ReadonlyMap<string, CustomerContact>> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Map();
  const response = await admin.customers.contactsOfCustomers(principal, {
    tenantId,
    customerIds: ids,
  });
  if (response.status !== 200) return new Map();
  return new Map((response.body as readonly CustomerContact[]).map((c) => [c.id, c]));
}

/** The full `DraftOrderDto`: pictures, customer, estimated tax, order number and links in a few reads. */
export async function draftDetailOf(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  draft: DraftOrder,
): Promise<DraftOrderDto> {
  const [images, contacts, tax, numbers, links] = await Promise.all([
    resolveLineImages(
      admin,
      tenantId,
      draft.lines.map((l) => ({ productId: l.productRef, variantId: l.variantRef })),
    ),
    contactsOf(admin, principal, tenantId, draft.customerRef === null ? [] : [draft.customerRef]),
    estimatedTaxOf(admin, tenantId, draft),
    orderNumbersOf(admin, principal, tenantId, draft.orderRef === null ? [] : [draft.orderRef]),
    admin.publicReads.checkout.listDraftLinks({ tenantId, draftOrderRef: draft.id }),
  ]);
  const contact = draft.customerRef === null ? undefined : contacts.get(draft.customerRef);
  return toDraftOrderDto(draft, {
    images,
    customer:
      draft.customerRef === null
        ? null
        : { id: draft.customerRef, name: contact?.name ?? null, email: contact?.email ?? null },
    tax,
    orderNumber: draft.orderRef === null ? null : (numbers.get(draft.orderRef) ?? null),
    links: links.status === 200 ? (links.body as readonly CheckoutLink[]) : [],
  });
}

/**
 * Rulings 4 and 17: the draft's open checkout stops; a closed or vanished one is left alone. True when
 * nothing is open any more; false when Checkout could not be read or refused to expire it.
 */
export async function expireDraftCheckout(
  admin: WiredAdmin,
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

/** DELETE stopped before the soft delete: the draft is untouched and the merchant can try again. */
function notDeleted(what: string): AdminResponse {
  return {
    status: 503,
    body: toErrorEnvelope(
      new UnexpectedError(`Could not ${what}; the draft order was not deleted. Try again.`),
    ),
  };
}

/** Orders' own refusal, worded the same: a completed draft is an order now. */
const draftCompleted = (): AdminResponse =>
  draftConflict("DRAFT_COMPLETED", "this draft order is already an order");

const alreadyCompleted = (): AdminResponse =>
  draftConflict("ALREADY_COMPLETED", "this draft order is already an order");

type DraftPayment = "paid" | "collect_on_delivery";

/** Spec §4.6 step 1: Mark as paid → the staff-recorded `manual` provider; Collect on delivery → `cod`. */
const providerOf = (payment: DraftPayment): "manual" | "cod" =>
  payment === "paid" ? "manual" : "cod";

const paymentNotRecorded = (message: string): AdminResponse =>
  draftConflict("PAYMENT_NOT_RECORDED", message);

/**
 * Spec §4.6 steps 3–4, both idempotent: open the payment through Checkout's `InitiatePayment` on the
 * draft's own session (the order → payment_requested; Payments serves `manual` only because that
 * session carries draft terms), and for "paid" settle the `manual` intent through the confirmed
 * collection with the intent's OWN amount (never a client figure). A failure answers 409
 * PAYMENT_NOT_RECORDED; the same request resumes (Ruling 6).
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
    initiated = await admin.publicReads.checkout.initiatePayment({ tenantId, checkoutSessionId });
  } catch (error) {
    // Payments' refusal is thrown by the initiation adapter; the order stands and a retry resumes.
    logger.warn("draft order payment could not be opened", {
      tenantId,
      orderRef,
      error: error instanceof Error ? error.message : String(error),
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

/** Order operations Part 4 — Orders → Drafts (spec §4.8). */
export function draftOrderRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/draft-orders",
      version: 1,
      permission: "orders:read",
      summary: "Draft orders, newest first (status, search by #number, email, phone or name)",
      schema: { querystring: listQuery },
      handle: async ({ query, context }) => {
        const response = await admin.draftOrders.list(context.principal, {
          tenantId: context.tenantId,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.q === undefined ? {} : { search: query.q }),
          ...(query.first === undefined ? {} : { first: query.first }),
          ...(query.after === undefined ? {} : { after: query.after }),
        });
        if (response.status !== 200) return response;
        const page = response.body as DraftOrderPage;
        const [numbers, contacts] = await Promise.all([
          orderNumbersOf(
            admin,
            context.principal,
            context.tenantId,
            page.items.flatMap((d) => (d.orderRef === null ? [] : [d.orderRef])),
          ),
          contactsOf(
            admin,
            context.principal,
            context.tenantId,
            page.items.flatMap((d) => (d.customerRef === null ? [] : [d.customerRef])),
          ),
        ]);
        return {
          status: 200,
          body: {
            items: page.items.map((draft) =>
              toDraftListItemDto(draft, {
                customerName:
                  draft.shippingAddress?.name ??
                  (draft.customerRef === null
                    ? undefined
                    : contacts.get(draft.customerRef)?.name) ??
                  draft.contactEmail ??
                  draft.contactPhone,
                orderNumber: draft.orderRef === null ? null : (numbers.get(draft.orderRef) ?? null),
              }),
            ),
            pageInfo: page.pageInfo,
          },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary:
        "Create a draft order — lines priced from Catalog, the merchant's discount and shipping",
      schema: { body: draftBody },
      handle: async ({ body, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const currency = await storeCurrencyOf(admin);
        if (currency === null) return currencyUnavailable();
        const content = await draftContentFrom(
          admin,
          context.principal,
          context.tenantId,
          body,
          currency,
        );
        if (!content.ok) return content.response;
        const created = await admin.draftOrders.create(context.principal, {
          tenantId: context.tenantId,
          createdBy: context.principal.id,
          currency,
          content: content.content,
        });
        if (created.status !== 201) return withConflictCode(created);
        const { draft } = created.body as DraftOrderOutput;
        return {
          status: 201,
          body: await draftDetailOf(admin, context.principal, context.tenantId, draft),
        };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:read",
      summary: "One draft order: lines, totals with estimated tax, customer, links",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (response.status !== 200) return response;
        // Ruling 10: a draft whose checkout became an order reads as completed, whoever paid.
        const draft = await healedDraft(admin, context.tenantId, response.body as DraftOrder);
        return {
          status: 200,
          body: await draftDetailOf(admin, context.principal, context.tenantId, draft),
        };
      },
    }),
    defineRoute({
      method: "PUT",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary: "Replace a draft order's content (version-checked); refused once completed",
      schema: { params: draftIdParams, body: updateBody },
      handle: async ({ params, body, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const before = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (before.status !== 200) return before;
        const draft = before.body as DraftOrder;
        // Refused before re-pricing, so a product sold out since never hides the real answer.
        if (draft.status === "completed") return draftCompleted();
        const content = await draftContentFrom(
          admin,
          context.principal,
          context.tenantId,
          body,
          draft.currency,
        );
        if (!content.ok) return content.response;
        const updated = await admin.draftOrders.update(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
          version: body.version,
          content: content.content,
        });
        if (updated.status !== 200) return withConflictCode(updated);
        // Ruling 4: a customer on the invoice checkout must not pay the superseded quote. The edit is
        // already saved, so a failure here is logged, not answered (Task 7 re-materialises on claim).
        if (!(await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef))) {
          logger.warn("draft order edited but its open checkout could not be expired", {
            tenantId: context.tenantId,
            draftId: draft.id,
          });
        }
        const { draft: saved } = updated.body as DraftOrderOutput;
        return {
          status: 200,
          body: await draftDetailOf(admin, context.principal, context.tenantId, saved),
        };
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/draft-orders/:draftId",
      version: 1,
      permission: "orders:draft",
      idempotent: true,
      summary: "Delete a draft order (soft); its invoice links stop working",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const before = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (before.status !== 200) return before;
        const draft = before.body as DraftOrder;
        if (draft.status === "completed") return draftCompleted();
        // Ruling 17: links revoked and the open checkout stopped BEFORE the soft delete; if either
        // fails, nothing is deleted. Race (accepted): a draft completed between the read above and
        // `remove` below keeps its order, `remove` answers 409 DRAFT_COMPLETED, but its links were
        // revoked here, so they answer the uniform 404 instead of Ruling 11's "already placed".
        const revoked = await admin.publicReads.checkout.revokeDraftLinks({
          tenantId: context.tenantId,
          draftOrderRef: draft.id,
        });
        if (revoked.status !== 200) return notDeleted("stop the draft order's invoice links");
        if (!(await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef))) {
          return notDeleted("close the draft order's open checkout");
        }
        return withConflictCode(
          await admin.draftOrders.remove(context.principal, {
            tenantId: context.tenantId,
            draftId: params.draftId,
          }),
        );
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/shipping-rates",
      version: 1,
      permission: "orders:draft",
      summary: "The shop's shipping rates for a draft's saved address and lines",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const denied = await admin.draftOrders.authorizeDraft(context.principal);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(context.principal, {
          tenantId: context.tenantId,
          draftId: params.draftId,
        });
        if (found.status !== 200) return found;
        const draft = found.body as DraftOrder;
        const address = draft.shippingAddress;
        if (address === null || draft.lines.length === 0) {
          return invalidResponse("Add products and a shipping address first", [
            { field: "shippingAddress", message: "required" },
          ]);
        }
        const quoted = await draftRateQuotes(
          admin,
          context.tenantId,
          draft.currency,
          address,
          draft.lines,
        );
        return quoted.ok ? { status: 200, body: { rates: quoted.rates } } : quoted.response;
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/invoice-link",
      version: 1,
      permission: "orders:draft",
      // NOT idempotent (binding carry 2): every call mints a new token, and the idempotency response
      // cache would otherwise keep the plaintext token — stored nowhere else — for 24 hours. The server
      // logs the route PATTERN only, never the URL or the body, so the token never reaches a log.
      summary:
        "Send invoice: a new 30-day payment link for a draft order (the token is shown once)",
      schema: { params: draftIdParams },
      handle: async ({ params, context }) => {
        const { tenantId, principal } = context;
        const denied = await admin.draftOrders.authorizeDraft(principal);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(principal, { tenantId, draftId: params.draftId });
        if (found.status !== 200) return found;
        const draft = await healedDraft(admin, tenantId, found.body as DraftOrder);
        if (draft.status === "completed") return draftCompleted();
        // The checkout first: a draft that cannot be checked out gets no link and stays as it was.
        const built = await materializeDraftCheckout(admin, tenantId, draft, { fresh: false });
        if (!built.ok) return built.response;
        const marked = await admin.draftOrders.markInvoiceSent(principal, {
          tenantId,
          draftId: draft.id,
        });
        if (marked.status !== 200) return withDraftConflictCode(marked);
        const issued = await admin.publicReads.checkout.issueInvoiceLink({
          tenantId,
          draftOrderRef: draft.id,
          createdBy: principal.id,
        });
        if (issued.status !== 201) return issued;
        const { token, expiresAt } = issued.body as IssueInvoiceLinkOutput;
        const path = `/c/${token}`;
        const hostname = primaryHostnameOf(await admin.shopDomains(tenantId));
        return {
          status: 201,
          body: {
            url: shopLinkUrl(hostname, path),
            path,
            expiresAt,
            shopName: await shopNameOf(admin),
          },
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/draft-orders/:draftId/complete",
      version: 1,
      permission: "orders:complete_draft",
      // Guards against a second order (Pre-flight 9): this route's idempotency cache per request key,
      // the screen's single-flight, the compare-and-set on the draft's session, and the session state
      // (an order already placed from it is resumed below). The completion key does not dedupe.
      idempotent: true,
      summary:
        "Create the order from a draft: Mark as paid (manual payment) or Collect on delivery (COD)",
      schema: {
        params: draftIdParams,
        body: z.object({ payment: z.enum(["paid", "collect_on_delivery"]) }).strict(),
      },
      handle: async ({ params, body, context }) => {
        const { tenantId, principal } = context;
        const denied = await admin.draftOrders.authorizeCompletion(principal, body.payment);
        if (denied !== null) return denied;
        const found = await admin.draftOrders.get(principal, { tenantId, draftId: params.draftId });
        if (found.status !== 200) return found;
        const draft = found.body as DraftOrder;
        const current = await draftCheckoutOf(admin, tenantId, draft.checkoutRef);
        if (!current.ok) return current.response;
        if (draft.status === "completed" || current.session?.orderRef != null) {
          return resumeCompletion(admin, principal, tenantId, draft, current.session, body.payment);
        }

        const missing = draftRequirements(draft.content(), "complete");
        if (missing.length > 0) {
          return invalidResponse(
            "This draft order is not ready",
            missing.map((field) => ({ field, message: "required" })),
          );
        }
        if (body.payment === "collect_on_delivery") {
          // Ruling 7: refused before anything is built — the merchant's own payment settings decide.
          const offered = await admin.publicReads.checkout.listPaymentMethods({ tenantId });
          const methods =
            offered.status === 200
              ? (offered.body as { readonly methods: readonly string[] }).methods
              : [];
          if (!methods.includes("cod")) {
            return draftConflict(
              "COD_NOT_ENABLED",
              "turn on cash on delivery in Settings → Payments",
            );
          }
        }
        // Ruling 5: always a fresh session; Checkout expires the open one (a customer's invoice
        // checkout) in the same unit of work, only once the new one is complete.
        const built = await materializeDraftCheckout(admin, tenantId, draft, { fresh: true });
        if (!built.ok) return built.response;
        const { checkoutSessionId } = built;
        const selected = await admin.publicReads.checkout.selectDraftPayment({
          tenantId,
          checkoutSessionId,
          provider: providerOf(body.payment),
        });
        if (selected.status !== 200) return withDraftConflictCode(selected);
        const completed = await admin.publicReads.checkout.complete({
          tenantId,
          checkoutSessionId,
          idempotencyKey: `draft:${draft.id}:${draft.version}`,
          actorRef: principal.id,
        });
        if (completed.status !== 200) return withDraftConflictCode(completed);
        const { orderRef } = completed.body as { readonly orderRef: string };
        // Explicit and idempotent: the report inside CompleteCheckout is best effort.
        const unrecorded = await recordDraftCompletion(admin, principal, tenantId, {
          draftId: draft.id,
          orderRef,
        });
        if (unrecorded !== null) return unrecorded;
        return finishPayment(admin, principal, tenantId, checkoutSessionId, orderRef, body.payment);
      },
    }),
  ] as readonly RouteDefinition[];
}
