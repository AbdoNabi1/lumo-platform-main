import { z } from "zod";
import type { Collection } from "@platform/catalog";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { NotFoundError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

export interface AdminCollectionDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "draft" | "published";
  readonly productIds: readonly string[];
  readonly productCount: number;
}
export function toAdminCollectionDto(c: Collection): AdminCollectionDto {
  return {
    id: c.id.value,
    name: c.name,
    slug: c.slug.value,
    status: c.status,
    productIds: c.productIds,
    productCount: c.productIds.length,
  };
}
const params = z.object({ collectionId: z.string().uuid() });
const memberParams = params.extend({ productId: z.string().uuid() });
const page = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().optional(),
});
const listQuery = page.extend({ query: z.string().min(1).optional() });
const name = z.string().min(1).max(255);
export function collectionsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/collections",
      version: 1,
      permission: "collections:read",
      summary: "List collections",
      schema: { querystring: listQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.collections.list(context.principal, { ...query, tenantId: context.tenantId }),
          toAdminCollectionDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/collections/:collectionId",
      version: 1,
      permission: "collections:read",
      summary: "Get collection",
      schema: { params },
      handle: async ({ params, context }) => {
        const result = await admin.collections.getByIds(context.principal, {
          ids: [params.collectionId],
          tenantId: context.tenantId,
        });
        if (result.status !== 200) return result;
        const collection = (result.body as readonly Collection[])[0];
        if (!collection)
          return { status: 404, body: toErrorEnvelope(new NotFoundError("Collection not found")) };
        return { status: 200, body: toAdminCollectionDto(collection) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/collections/:collectionId/products",
      version: 1,
      permission: "collections:read",
      summary: "List collection members",
      schema: { params, querystring: page },
      handle: ({ params, query, context }) =>
        admin.collections.listMembers(context.principal, {
          ...query,
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections",
      version: 1,
      permission: "collections:create",
      idempotent: true,
      summary: "Create collection",
      schema: { body: z.object({ name, slug: name }) },
      handle: ({ body, context }) =>
        admin.collections.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId",
      version: 1,
      permission: "collections:update",
      idempotent: true,
      summary: "Rename collection",
      schema: { params, body: z.object({ name }) },
      handle: ({ params, body, context }) =>
        admin.collections.rename(context.principal, {
          ...body,
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/products",
      version: 1,
      permission: "collections:update",
      idempotent: true,
      summary: "Add collection member",
      schema: { params, body: z.object({ productId: z.string().uuid() }) },
      handle: ({ params, body, context }) =>
        admin.collections.addProduct(context.principal, {
          ...body,
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/products/:productId/delete",
      version: 1,
      permission: "collections:update",
      idempotent: true,
      summary: "Remove collection member",
      schema: { params: memberParams },
      handle: ({ params, context }) =>
        admin.collections.removeProduct(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/reorder",
      version: 1,
      permission: "collections:update",
      idempotent: true,
      summary: "Reorder collection members",
      schema: { params, body: z.object({ productIds: z.array(z.string().uuid()) }) },
      handle: ({ params, body, context }) =>
        admin.collections.reorderProducts(context.principal, {
          ...body,
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/publish",
      version: 1,
      permission: "collections:publish",
      idempotent: true,
      summary: "Publish collection",
      schema: { params },
      handle: ({ params, context }) =>
        admin.collections.publish(context.principal, {
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/unpublish",
      version: 1,
      permission: "collections:publish",
      idempotent: true,
      summary: "Unpublish collection",
      schema: { params },
      handle: ({ params, context }) =>
        admin.collections.unpublish(context.principal, {
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/collections/:collectionId/delete",
      version: 1,
      permission: "collections:delete",
      idempotent: true,
      summary: "Delete collection",
      schema: { params },
      handle: ({ params, context }) =>
        admin.collections.delete(context.principal, {
          collectionId: params.collectionId,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
