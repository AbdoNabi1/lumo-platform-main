import { z } from "zod";
import type { Principal } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  MAX_TAGS_PER_ORDER,
  type ChangeOrderTagsOutput,
  type OrderTimelineEntry,
  type UpdateOrderNoteOutput,
} from "@platform/orders";
import { NotFoundError, toErrorEnvelope, ValidationError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { toTimelineEntryDto } from "./order-timeline-dto";

const orderIdParams = z.object({ orderId: z.string().min(1) });
const commentParams = z.object({ orderId: z.string().min(1), entryId: z.string().min(1) });
// Bodies are bounded generously by size here; the use cases apply the exact character limits.
const noteBody = z.object({ note: z.string().max(20_000).nullable() }).strict();
const tagList = z.array(z.string().max(400)).max(MAX_TAGS_PER_ORDER);
const tagsBody = z
  .object({ add: tagList.optional(), remove: tagList.optional() })
  .strict()
  .refine((body) => (body.add?.length ?? 0) + (body.remove?.length ?? 0) > 0, {
    message: "Add or remove at least one tag",
    path: ["add"],
  });
const commentBody = z.object({ body: z.string().max(20_000) }).strict();
const tagSuggestionsQuery = z.object({ q: z.string().max(200).optional() });

function notFound(message: string): AdminResponse {
  return { status: 404, body: toErrorEnvelope(new NotFoundError(message)) };
}

/** One order's tag change (spec §2.3): add first, then remove; answers the tags after both. */
async function changeTagsOfOne(
  admin: WiredAdmin,
  principal: Principal,
  tenantId: string,
  orderId: string,
  body: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
): Promise<AdminResponse> {
  let tags: readonly string[] = [];
  for (const [list, add] of [
    [body.add, true],
    [body.remove, false],
  ] as const) {
    if (list === undefined || list.length === 0) continue;
    const input = { tenantId, orderIds: [orderId], tags: list };
    const response = add
      ? await admin.orders.addOrderTags(principal, input)
      : await admin.orders.removeOrderTags(principal, input);
    if (response.status !== 200) return response;
    const result = (response.body as ChangeOrderTagsOutput).results[0];
    if (result === undefined || result.outcome === "not_found") return notFound("Order not found");
    if (result.outcome === "too_many_tags") {
      return {
        status: 422,
        body: toErrorEnvelope(
          new ValidationError(`An order can have at most ${MAX_TAGS_PER_ORDER} tags`, [
            { field: "add", message: `would pass ${MAX_TAGS_PER_ORDER} tags` },
          ]),
        ),
      };
    }
    tags = result.tags;
  }
  return { status: 200, body: { tags } };
}

/**
 * The DTO a writer gets back for their own comment (moderation does not change their own buttons).
 * Goes through {@link toTimelineEntryDto}, so a deleted comment's body is never answered.
 */
function ownEntry(response: AdminResponse, principal: Principal, status: number): AdminResponse {
  return {
    status,
    body: toTimelineEntryDto(response.body as OrderTimelineEntry, {
      actorRef: principal.id,
      canModerate: false,
    }),
  };
}

/** Order operations Part 2 — the note, tags and comments of one order (spec §2.3). */
export function orderAnnotationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "PUT",
      path: "/orders/:orderId/note",
      version: 1,
      permission: "orders:edit_note",
      idempotent: true,
      summary:
        "Set or clear the order's staff note (outside the aggregate; never bumps its version)",
      schema: { params: orderIdParams, body: noteBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.updateOrderNote(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          note: body.note,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: { note: (response.body as UpdateOrderNoteOutput).note } };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/tags",
      version: 1,
      permission: "orders:tag",
      idempotent: true,
      summary: "Add and/or remove tags on one order (case-insensitive; at most 250 per order)",
      schema: { params: orderIdParams, body: tagsBody },
      handle: ({ params, body, context }) =>
        changeTagsOfOne(admin, context.principal, context.tenantId, params.orderId, body),
    }),
    defineRoute({
      method: "GET",
      path: "/order-tags",
      version: 1,
      permission: "orders:read",
      summary:
        "The shop's order tags starting with q, most used first (at most 50) — tag suggestions",
      schema: { querystring: tagSuggestionsQuery },
      handle: ({ query, context }) =>
        admin.orders.suggestOrderTags(context.principal, {
          tenantId: context.tenantId,
          ...(query.q === undefined ? {} : { prefix: query.q }),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/comments",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary:
        "Leave a staff comment on the order's timeline (author = the signed-in staff member)",
      schema: { params: orderIdParams, body: commentBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.addOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          body: body.body,
        });
        return response.status === 201 ? ownEntry(response, context.principal, 201) : response;
      },
    }),
    defineRoute({
      method: "PATCH",
      path: "/orders/:orderId/comments/:entryId",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary: "Edit your own comment",
      schema: { params: commentParams, body: commentBody },
      handle: async ({ params, body, context }): Promise<AdminResponse> => {
        const response = await admin.orders.editOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          entryId: params.entryId,
          body: body.body,
        });
        return response.status === 200 ? ownEntry(response, context.principal, 200) : response;
      },
    }),
    defineRoute({
      method: "DELETE",
      path: "/orders/:orderId/comments/:entryId",
      version: 1,
      permission: "orders:comment",
      idempotent: true,
      summary: "Delete a comment (yours, or anyone's as an admin); it stays on record as deleted",
      schema: { params: commentParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.orders.deleteOrderComment(context.principal, {
          tenantId: context.tenantId,
          orderId: params.orderId,
          entryId: params.entryId,
        });
        return response.status === 200 ? ownEntry(response, context.principal, 200) : response;
      },
    }),
  ];
}
