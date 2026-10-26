import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { CheckoutLink } from "@platform/checkout";
import type { CustomerContact } from "@platform/identity";
import {
  DRAFT_ORDER_STATUSES,
  DRAFT_PAGE_SIZE_MAX,
  type DraftOrder,
  type DraftOrderOutput,
  type DraftOrderPage,
  type Order,
} from "@platform/orders";
import { toErrorEnvelope, UnexpectedError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
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

/** Best effort (Rulings 4 and 17): the draft's open checkout stops; a closed one is left alone. */
export async function expireDraftCheckout(
  admin: WiredAdmin,
  tenantId: string,
  checkoutRef: string | null,
): Promise<void> {
  if (checkoutRef === null) return;
  const response = await admin.publicReads.checkout.get({
    tenantId,
    checkoutSessionId: checkoutRef,
  });
  if (response.status !== 200) return;
  const session = response.body as { readonly state: { readonly isOpen: boolean } };
  if (session.state.isOpen) {
    await admin.publicReads.checkout.expire({ tenantId, checkoutSessionId: checkoutRef });
  }
}

/** Orders' own refusal, worded the same: a completed draft is an order now. */
const draftCompleted = (): AdminResponse =>
  draftConflict("DRAFT_COMPLETED", "this draft order is already an order");

/** Order operations Part 4 — Orders → Drafts (spec §4.8). Task 7 appends invoice-link and complete. */
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
        return {
          status: 200,
          body: await draftDetailOf(
            admin,
            context.principal,
            context.tenantId,
            response.body as DraftOrder,
          ),
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
        // Ruling 4: a customer on the invoice checkout must not pay the superseded quote.
        await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef);
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
        // Ruling 17: links revoked and the open checkout stopped BEFORE the soft delete.
        await admin.publicReads.checkout.revokeDraftLinks({
          tenantId: context.tenantId,
          draftOrderRef: draft.id,
        });
        await expireDraftCheckout(admin, context.tenantId, draft.checkoutRef);
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
  ] as readonly RouteDefinition[];
}
