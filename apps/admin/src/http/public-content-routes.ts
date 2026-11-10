import { z } from "zod";
import { defineRoute, type RouteDefinition, type TransportResponse } from "@platform/http";
import type { Page } from "@platform/pages";
import {
  PAGE_HANDLE_PATTERN,
  pageHandleOfPath,
  POLICY_TYPES,
  type LocalizedText,
} from "@platform/storefront-content";
import type { WiredAdmin } from "../composition";
import { localizedCopy } from "./localized-text";
import { uncached } from "./uncached-response";

const typeParams = z.object({ type: z.enum(POLICY_TYPES) });
/** The one handle rule (`@platform/storefront-content`): a bad handle is 422, never a lookup. */
const handleParams = z.object({ handle: z.string().regex(PAGE_HANDLE_PATTERN) });

/** A published page as the storefront sees it: no id, status, version, route path or tenant. */
export interface PublicPageDto {
  readonly handle: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
  readonly metaDescription: LocalizedText;
  readonly updatedAt: string | null;
}

export interface PublicPageListItemDto {
  readonly handle: string;
  readonly updatedAt: string | null;
}

/** Ruling 16: a page saved before it had a title shows its name, in English. */
function titleOf(page: Page): LocalizedText {
  const title = localizedCopy(page.title);
  return title.ar === undefined && title.en === undefined ? { en: page.name } : title;
}

function toPublicPageDto(page: Page, handle: string): PublicPageDto {
  return {
    handle,
    title: titleOf(page),
    body: localizedCopy(page.body),
    metaDescription: localizedCopy(page.metaDescription),
    updatedAt: page.updatedAt?.toISOString() ?? null,
  };
}

function toPublicPageList(pages: readonly Page[]): PublicPageListItemDto[] {
  return pages.flatMap((page) => {
    const handle = pageHandleOfPath(page.routePath.value);
    return handle === null ? [] : [{ handle, updatedAt: page.updatedAt?.toISOString() ?? null }];
  });
}

/** Maps a 200 to its DTO; any refusal passes through with its code. */
function mapOk(response: TransportResponse, toDto: (body: unknown) => unknown): TransportResponse {
  return response.status === 200 ? { status: 200, body: toDto(response.body) } : response;
}

/**
 * Online Store Part 2 (spec 2.6): the storefront's anonymous reads of set store policies and
 * published `/pages/<handle>` pages, each through a `publicReads` closure with the request's
 * tenant. Kept apart from `public-online-store-routes.ts`, whose routes the storefront's runtime
 * contract pins to `/public/online-store…`. Every answer, a 404 included, is `private, no-store`:
 * the shop comes from a header, so no shared cache may keep one. A Pages or Online Store failure
 * throws and is a 5xx, never a 404 that would make a live page vanish.
 */
export function publicContentRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/policies/:type",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary: "Public: one store policy's text (type, body, updatedAt); 404 when it is not set",
      schema: { params: typeParams },
      handle: async ({ params, context }) =>
        uncached(await admin.publicReads.onlineStore.policy(context.tenantId, params.type)),
    }),
    defineRoute({
      method: "GET",
      path: "/public/pages/:handle",
      version: 1,
      permission: "pages:read",
      public: true,
      summary: "Public: a published page at /pages/<handle>; 404 for a draft or unknown page",
      schema: { params: handleParams },
      handle: async ({ params, context }) =>
        uncached(
          mapOk(await admin.publicReads.pages.byHandle(context.tenantId, params.handle), (body) =>
            toPublicPageDto(body as Page, params.handle),
          ),
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/public/pages",
      version: 1,
      permission: "pages:read",
      public: true,
      summary: "Public: the published /pages/<handle> pages (handle, updatedAt), at most 500",
      schema: {},
      handle: async ({ context }) =>
        uncached(
          mapOk(await admin.publicReads.pages.list(context.tenantId), (body) => ({
            pages: toPublicPageList(body as readonly Page[]),
          })),
        ),
    }),
  ] as readonly RouteDefinition[];
}
