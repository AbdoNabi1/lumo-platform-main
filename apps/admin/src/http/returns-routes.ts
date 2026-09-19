import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ReturnRequest } from "@platform/returns";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";

const createReturnRequestBody = z.object({
  orderRef: z.string().min(1),
  items: z
    .array(
      z.object({
        orderItemRef: z.string().min(1),
        productRef: z.string().min(1),
        quantity: z.number().int().positive(),
        reasonCode: z.string().min(1),
        reasonNote: z.string().min(1).optional(),
      }),
    )
    .min(1),
});
const returnIdParams = z.object({ returnId: z.string().min(1) });
const decisionBody = z.object({ approved: z.boolean(), note: z.string().min(1).optional() });
const rmaBody = z.object({ rmaNumber: z.string().min(1) });
const receiveBody = z.object({ source: z.string().min(1), callbackId: z.string().min(1) });
const inspectionBody = z.object({
  itemRef: z.string().min(1),
  passed: z.boolean(),
  note: z.string().min(1).optional(),
});
const acceptBody = z.object({
  items: z
    .array(z.object({ orderItemRef: z.string().min(1), disposition: z.string().min(1) }))
    .min(1),
});
const advanceBody = z.object({ toStatus: z.string().min(1) });
const resolutionBody = z.object({
  outcome: z.enum(["refund", "replacement", "repair"]),
  amountMinor: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
});
const returnByOrderParams = z.object({ orderId: z.string().min(1) });

/** `ReturnRequest` (`@platform/returns`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}. */
export interface ReturnDetailDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly items: readonly {
    readonly orderItemRef: string;
    readonly productRef: string;
    readonly quantity: number;
    readonly reasonCode: string;
    readonly reasonNote: string | null;
    readonly disposition: string | null;
  }[];
  readonly rmaNumber: string | null;
  readonly approved: boolean | null;
  readonly approvalNote: string | null;
  readonly refundOutcome: string | null;
  readonly refundAmountMinor: number | null;
  readonly refundCurrency: string | null;
}

function toReturnDetailDto(returnRequest: ReturnRequest): ReturnDetailDto {
  return {
    id: returnRequest.id.toString(),
    orderRef: returnRequest.orderRef,
    status: returnRequest.status.value,
    items: returnRequest.items.map((item) => ({
      orderItemRef: item.orderItemRef,
      productRef: item.productRef.value,
      quantity: item.quantity,
      reasonCode: item.reason.code,
      reasonNote: item.reason.note ?? null,
      disposition: item.disposition?.value ?? null,
    })),
    rmaNumber: returnRequest.rmaNumber ?? null,
    approved: returnRequest.approval?.approved ?? null,
    approvalNote: returnRequest.approval?.note ?? null,
    refundOutcome: returnRequest.refundDecision?.outcome ?? null,
    refundAmountMinor: returnRequest.refundDecision?.amountMinor ?? null,
    refundCurrency: returnRequest.refundDecision?.currency ?? null,
  };
}

/**
 * The Returns admin HTTP surface (Sprint 4.11 — Returns' first HTTP transport, per
 * `SPRINT_4_11_RETURNS_CORE_REPORT.md` §2: "ReturnsController + ReturnsAdminController +
 * returns-routes (8 versioned zod routes under /returns: create / decision / rma / receive /
 * inspection / accept / transitions / resolution)"). Pure delegation — zod validates the boundary,
 * the facade authorizes + audits (AdminGuard), the context owns all behavior.
 */
export function returnsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/returns",
      version: 1,
      permission: "returns:create",
      idempotent: true,
      summary: "Open a return request (RMA) for an order's items",
      schema: { body: createReturnRequestBody },
      handle: ({ body, context }) =>
        admin.returns.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/decision",
      version: 1,
      permission: "returns:decision",
      idempotent: true,
      summary: "Approve or reject a return request",
      schema: { params: returnIdParams, body: decisionBody },
      handle: ({ params, body, context }) =>
        admin.returns.decision(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/rma",
      version: 1,
      permission: "returns:rma",
      idempotent: true,
      summary: "Generate the RMA number for an approved return",
      schema: { params: returnIdParams, body: rmaBody },
      handle: ({ params, body, context }) =>
        admin.returns.rma(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/receive",
      version: 1,
      permission: "returns:receive",
      summary: "Record the returned package's receipt (verified with Shipping, replay-safe)",
      schema: { params: returnIdParams, body: receiveBody },
      handle: ({ params, body, context }) =>
        admin.returns.receive(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/inspection",
      version: 1,
      permission: "returns:inspection",
      summary: "Record one item's inspection result (idempotent by itemRef)",
      schema: { params: returnIdParams, body: inspectionBody },
      handle: ({ params, body, context }) =>
        admin.returns.inspection(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/accept",
      version: 1,
      permission: "returns:accept",
      idempotent: true,
      summary: "Accept inspected items with their dispositions (restocks via InventoryPort)",
      schema: { params: returnIdParams, body: acceptBody },
      handle: ({ params, body, context }) =>
        admin.returns.accept(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/transitions",
      version: 1,
      permission: "returns:advance",
      idempotent: true,
      summary:
        "Advance a return request to any status its current status's transition table allows",
      schema: { params: returnIdParams, body: advanceBody },
      handle: ({ params, body, context }) =>
        admin.returns.advance(context.principal, {
          returnId: params.returnId,
          tenantId: context.tenantId,
          toStatus: body.toStatus as Parameters<typeof admin.returns.advance>[1]["toStatus"],
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/orders/:orderId/return",
      version: 1,
      permission: "returns:read",
      summary: "Get the return request opened for an order, if any",
      schema: { params: returnByOrderParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.returns.getByOrder(context.principal, {
          tenantId: context.tenantId,
          orderRef: params.orderId,
        });
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toReturnDetailDto(response.body as ReturnRequest) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/returns/:returnId/resolution",
      version: 1,
      permission: "returns:resolution",
      idempotent: true,
      summary: "Decide the resolution (refund/replacement/repair) for accepted items",
      schema: { params: returnIdParams, body: resolutionBody },
      handle: ({ params, body, context }) =>
        admin.returns.resolution(context.principal, {
          returnId: params.returnId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
