import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { SearchIndex } from "@platform/search";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const createIndexBody = z.object({ name: z.string().min(1) });
const indexIdParams = z.object({ indexId: z.string().min(1) });

export interface SearchIndexDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly documentCount: number;
  readonly synonyms: readonly { readonly term: string; readonly synonyms: readonly string[] }[];
  readonly facetFields: readonly string[];
  readonly sortableFields: readonly string[];
  readonly suggestions: readonly string[];
}

function toSearchIndexDto(index: SearchIndex): SearchIndexDto {
  return {
    id: index.id.toString(),
    name: index.name,
    status: index.status.value,
    documentCount: index.documentCount,
    synonyms: index.config.synonyms,
    facetFields: index.config.facetFields,
    sortableFields: index.config.sortableFields,
    suggestions: index.config.suggestions,
  };
}
const advanceIndexBody = z.object({
  toStatus: z.enum(["active", "rebuilding", "disabled"]),
});
const upsertDocumentBody = z.object({
  productRef: z.string().min(1),
  title: z.string().min(1),
  categoryRefs: z.array(z.string().min(1)),
  attributes: z.record(z.string()).optional(),
});
const deleteDocumentBody = z.object({ productRef: z.string().min(1) });
const synonymBody = z.object({
  term: z.string().min(1),
  synonyms: z.array(z.string().min(1)).optional(),
});
const suggestionBody = z.object({ term: z.string().min(1) });
const logQueryBody = z.object({ term: z.string().min(1) });

/** The Search admin HTTP surface (Sprint S1). Pure delegation. */
export function searchRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/search/indexes",
      version: 1,
      permission: "search:create",
      idempotent: true,
      summary: "Create a search index",
      schema: { body: createIndexBody },
      handle: ({ body, context }) =>
        admin.search.create(context.principal, { ...body, tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/transitions",
      version: 1,
      permission: "search:advance",
      idempotent: true,
      summary: "Advance an index's status (rebuild/activate/disable)",
      schema: { params: indexIdParams, body: advanceIndexBody },
      handle: ({ params, body, context }) =>
        admin.search.advance(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/documents",
      version: 1,
      permission: "search:upsert_document",
      idempotent: true,
      summary: "Upsert a product document snapshot via IndexProviderPort",
      schema: { params: indexIdParams, body: upsertDocumentBody },
      handle: ({ params, body, context }) =>
        admin.search.upsertDocument(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/documents/delete",
      version: 1,
      permission: "search:delete_document",
      idempotent: true,
      summary: "Remove a product document via IndexProviderPort",
      schema: { params: indexIdParams, body: deleteDocumentBody },
      handle: ({ params, body, context }) =>
        admin.search.deleteDocument(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/synonyms",
      version: 1,
      permission: "search:add_synonym",
      idempotent: true,
      summary: "Add (or replace) a merchant synonym entry",
      schema: { params: indexIdParams, body: synonymBody },
      handle: ({ params, body, context }) =>
        admin.search.addSynonym(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/synonyms/remove",
      version: 1,
      permission: "search:remove_synonym",
      idempotent: true,
      summary: "Remove a merchant synonym entry",
      schema: { params: indexIdParams, body: synonymBody },
      handle: ({ params, body, context }) =>
        admin.search.removeSynonym(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/suggestions",
      version: 1,
      permission: "search:add_suggestion",
      idempotent: true,
      summary: "Add an autocomplete suggestion term",
      schema: { params: indexIdParams, body: suggestionBody },
      handle: ({ params, body, context }) =>
        admin.search.addSuggestion(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/search/indexes/:indexId/queries",
      version: 1,
      permission: "search:log_query",
      summary: "Log a search query for analytics",
      schema: { params: indexIdParams, body: logQueryBody },
      handle: ({ params, body, context }) =>
        admin.search.logQuery(context.principal, {
          indexId: params.indexId,
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/search/indexes",
      version: 1,
      permission: "search:read",
      summary: "List search indexes (cursor pagination) — what indexes exist at all",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.search.list(context.principal, { ...query, tenantId: context.tenantId }),
          toSearchIndexDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/search/indexes/:indexId",
      version: 1,
      permission: "search:read",
      summary: "Get one search index by id",
      schema: { params: indexIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.search.get(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toSearchIndexDto(response.body as SearchIndex) };
      },
    }),
  ] as readonly RouteDefinition[];
}
