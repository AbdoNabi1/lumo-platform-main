import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { ContentBlock } from "@platform/content";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const createContentBlockBody = z.object({
  name: z.string().min(1),
  blockType: z.string().min(1),
  format: z.enum(["html", "markdown", "json"]),
  content: z.string().min(1),
  locale: z.string().min(1).optional(),
});
const contentBlockIdParams = z.object({ contentBlockId: z.string().min(1) });
const advanceContentBlockBody = z.object({
  toStatus: z.enum(["draft", "scheduled", "published", "archived"]),
  scheduledAt: z.coerce.date().optional(),
});
const updateContentBodyBody = z.object({
  format: z.enum(["html", "markdown", "json"]),
  content: z.string().min(1),
});
const listContentBlocksQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
});

/** `ContentBlock` (`@platform/content`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}. */
export interface ContentBlockListItemDto {
  readonly id: string;
  readonly name: string;
  readonly blockType: string;
  readonly status: string;
  readonly locale: string | null;
}

function toContentBlockListItemDto(block: ContentBlock): ContentBlockListItemDto {
  return {
    id: block.id.toString(),
    name: block.name,
    blockType: block.blockType,
    status: block.status.value,
    locale: block.locale ?? null,
  };
}

/** The Content Blocks admin HTTP surface (Sprint 5.4). Pure delegation. */
export function contentRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/content-blocks",
      version: 1,
      permission: "content:create",
      idempotent: true,
      summary: "Create a content block",
      schema: { body: createContentBlockBody },
      handle: ({ body, context }) => admin.content.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/content-blocks/:contentBlockId/transitions",
      version: 1,
      permission: "content:advance",
      idempotent: true,
      summary: "Advance a content block's status",
      schema: { params: contentBlockIdParams, body: advanceContentBlockBody },
      handle: ({ params, body, context }) =>
        admin.content.advance(context.principal, {
          contentBlockId: params.contentBlockId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/content-blocks",
      version: 1,
      permission: "content:read",
      summary: "List content blocks, most recently created first (cursor-paginated)",
      schema: { querystring: listContentBlocksQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.content.list(context.principal, query), toContentBlockListItemDto),
    }),
    defineRoute({
      method: "POST",
      path: "/content-blocks/:contentBlockId/body",
      version: 1,
      permission: "content:update",
      idempotent: true,
      summary: "Update a content block's draft body",
      schema: { params: contentBlockIdParams, body: updateContentBodyBody },
      handle: ({ params, body, context }) =>
        admin.content.updateBody(context.principal, {
          contentBlockId: params.contentBlockId,
          ...body,
        }),
    }),
  ] as readonly RouteDefinition[];
}
