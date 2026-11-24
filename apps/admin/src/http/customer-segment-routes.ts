import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { WiredAdmin } from "../composition";

const segmentIdParams = z.object({ segmentId: z.string().min(1).max(100) });

// Transport schemas check STRUCTURE only (types, unknown keys, body-size bounds). Identity is the
// authority for every semantic limit — name 1..100 code points, 1..10 conditions, value ranges —
// and answers 422 `VALIDATION` with the failing field paths (`name`, `conditions.<i>.<field>`).
const createBody = z
  .object({ name: z.string().max(1000), conditions: z.array(z.unknown()).max(50) })
  .strict();
const previewBody = z
  .object({
    conditions: z.array(z.unknown()).max(50),
    first: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const updateBody = z
  .object({
    expectedVersion: z.number().int().min(1),
    name: z.string().max(1000).optional(),
    conditions: z.array(z.unknown()).max(50).optional(),
  })
  .strict();
const deleteBody = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const DEFAULT_MEMBERS_PAGE_SIZE = 50;
const membersQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).default(DEFAULT_MEMBERS_PAGE_SIZE),
  after: z.string().min(1).optional(),
  search: z.string().min(1).max(100).optional(),
});

/**
 * Wave 1c — Customers > Segments. Spread IMMEDIATELY AFTER `...customerRoutes(admin)` in
 * `admin-routes.ts`. `/customer-segments/preview` and `/customer-segments/store-currency` are
 * registered BEFORE `/customer-segments/:segmentId` so the parameter never swallows them. The
 * tenant always comes from the verified context. Every write is `POST` + `idempotent` (the
 * collections convention); the preview is a read and is NOT idempotent.
 */
export function customerSegmentRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/customer-segments",
      version: 1,
      permission: "customers:read",
      summary: "List the default and custom customer segments (defaults first, then by name)",
      schema: {},
      handle: ({ context }) =>
        admin.customerSegments.list(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-segments/store-currency",
      version: 1,
      permission: "customers:read",
      summary: "The shop currency the segment editor's money fields are in",
      schema: {},
      handle: ({ context }) =>
        admin.customerSegments.storeCurrency(context.principal, context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/customer-segments/preview",
      version: 1,
      permission: "customers:read",
      summary: "Preview the first members and the total of unsaved segment conditions",
      schema: { body: previewBody },
      handle: ({ body, context }) =>
        admin.customerSegments.preview(context.principal, {
          tenantId: context.tenantId,
          conditions: body.conditions,
          ...(body.first === undefined ? {} : { first: body.first }),
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-segments/:segmentId",
      version: 1,
      permission: "customers:read",
      summary: "Get one default or custom segment",
      schema: { params: segmentIdParams },
      handle: ({ params, context }) =>
        admin.customerSegments.get(context.principal, {
          tenantId: context.tenantId,
          segmentId: params.segmentId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/customer-segments/:segmentId/members",
      version: 1,
      permission: "customers:read",
      summary: "One page of the customers in a segment, with the live total (cursor-paginated)",
      schema: { params: segmentIdParams, querystring: membersQuery },
      handle: ({ params, query, context }) =>
        admin.customerSegments.members(context.principal, {
          tenantId: context.tenantId,
          segmentId: params.segmentId,
          first: query.first ?? DEFAULT_MEMBERS_PAGE_SIZE,
          ...(query.after === undefined ? {} : { after: query.after }),
          ...(query.search === undefined ? {} : { search: query.search }),
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customer-segments",
      version: 1,
      permission: "customers:manage_segments",
      idempotent: true,
      summary: "Create a custom segment (1..10 ANDed conditions, at most 100 per store)",
      schema: { body: createBody },
      handle: ({ body, context }) =>
        admin.customerSegments.create(context.principal, {
          tenantId: context.tenantId,
          name: body.name,
          conditions: body.conditions,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customer-segments/:segmentId/delete",
      version: 1,
      permission: "customers:manage_segments",
      idempotent: true,
      summary: "Delete a custom segment (expected version required; defaults cannot be deleted)",
      schema: { params: segmentIdParams, body: deleteBody },
      handle: ({ params, body, context }) =>
        admin.customerSegments.delete(context.principal, {
          tenantId: context.tenantId,
          segmentId: params.segmentId,
          expectedVersion: body.expectedVersion,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/customer-segments/:segmentId",
      version: 1,
      permission: "customers:manage_segments",
      idempotent: true,
      summary: "Rename a custom segment and/or replace its conditions (expected version required)",
      schema: { params: segmentIdParams, body: updateBody },
      handle: ({ params, body, context }) =>
        admin.customerSegments.update(context.principal, {
          tenantId: context.tenantId,
          segmentId: params.segmentId,
          expectedVersion: body.expectedVersion,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.conditions === undefined ? {} : { conditions: body.conditions }),
        }),
    }),
  ];
}
