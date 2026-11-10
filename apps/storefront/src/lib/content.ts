import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  PAGE_HANDLE_PATTERN,
  PAGE_META_DESCRIPTION_MAX,
  PAGE_TITLE_MAX,
  RICH_TEXT_MAX,
  type LocalizedText,
  type PolicyType,
} from "@platform/storefront-content";
import { textOf } from "./online-store";
import { currentShopId, RUNTIME_API_URL } from "./runtime-api";
import { shellTag } from "./shell-tag";

/**
 * Online Store Part 2 (spec 2.8): the storefront's reads of store policies and `/pages/<handle>`
 * pages. Live content only, cached per shop for 60 s under the shop's tag (Ruling 3), so a save in
 * the admin shows on the next request after it revalidates `os:<shopId>`. A 404 or a failure is
 * never stored (Ruling 4): it throws inside the cached function. Every body is re-normalised and
 * capped, whatever the Runtime sent.
 *
 * The shop-explicit reads (`readPolicy`, `readPage`, `readPageList`) take the shop id as an
 * argument and never read request headers, so the sitemap can call them inside its own
 * `unstable_cache` (preflight 1). `getPolicy` and `getPage` resolve the shop outside the cache.
 */

export type ContentRead<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "not-found" }
  | { readonly status: "error" };

/** The one handle rule (`@platform/storefront-content`, preflight 15), under the plan's name. */
export const PAGE_HANDLE = PAGE_HANDLE_PATTERN;

export interface PolicyContent {
  readonly type: PolicyType;
  readonly body: LocalizedText;
  readonly updatedAt: string | null;
}

export interface PageContent {
  readonly handle: string;
  readonly title: LocalizedText;
  readonly body: LocalizedText;
  readonly metaDescription: LocalizedText;
  readonly updatedAt: string | null;
}

export interface PageListItem {
  readonly handle: string;
  readonly updatedAt: string | null;
}

const CONTENT_TTL_SECONDS = 60;
const RUNTIME_TIMEOUT_MS = 3_000;
/** `GET /public/pages` answers at most this many (spec 2.6). */
const PAGE_LIST_MAX = 500;
const ISO_LENGTH_MAX = 40;

/** Thrown inside a cached read for a 404, so nothing is stored and the caller can tell it apart. */
class ContentNotFound extends Error {
  constructor() {
    super("storefront content not found");
    this.name = "ContentNotFound";
  }
}

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null;

/** A valid date as the Runtime's ISO string, else null (never a merchant-shaped string). */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length > ISO_LENGTH_MAX) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * One public Runtime read for `shopId`. Never throws: a refused, failed or timed-out read is
 * `status: 0`, an unreadable body is `null`.
 */
export async function fetchJson(
  shopId: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}/api/v1${path}`, {
      headers: { "x-tenant-id": shopId },
      cache: "no-store",
      signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * 200 with a usable (object) body → the sanitised value; 404 → `ContentNotFound`; anything else,
 * a 5xx, another 4xx, a timeout or an unusable body, is a failure. Both throw, so neither is cached.
 */
async function readOrThrow<T>(
  shopId: string,
  path: string,
  sanitize: (body: Raw) => T,
): Promise<T> {
  const res = await fetchJson(shopId, path);
  if (res.status === 404) throw new ContentNotFound();
  const body = obj(res.body);
  if (res.status !== 200 || body === null) {
    throw new Error(`storefront content read failed (${res.status})`);
  }
  return sanitize(body);
}

async function settle<T>(read: () => Promise<T>): Promise<ContentRead<T>> {
  try {
    return { status: "ok", value: await read() };
  } catch (error) {
    return error instanceof ContentNotFound ? { status: "not-found" } : { status: "error" };
  }
}

function policyOf(type: PolicyType, body: Raw): PolicyContent {
  return {
    type,
    body: textOf(body["body"], RICH_TEXT_MAX.body, true),
    updatedAt: isoOrNull(body["updatedAt"]),
  };
}

function pageOf(handle: string, body: Raw): PageContent {
  return {
    handle,
    title: textOf(body["title"], PAGE_TITLE_MAX),
    body: textOf(body["body"], RICH_TEXT_MAX.body, true),
    metaDescription: textOf(body["metaDescription"], PAGE_META_DESCRIPTION_MAX),
    updatedAt: isoOrNull(body["updatedAt"]),
  };
}

/** `GET /public/policies/:type` for one shop, cached under its key and tag. */
export function readPolicy(shopId: string, type: PolicyType): Promise<ContentRead<PolicyContent>> {
  return settle(
    unstable_cache(
      () => readOrThrow(shopId, `/public/policies/${type}`, (body) => policyOf(type, body)),
      ["online-store", shopId, "policy", type],
      { tags: [shellTag(shopId)], revalidate: CONTENT_TTL_SECONDS },
    ),
  );
}

/** `GET /public/pages/:handle` for one shop; a malformed handle is not-found without a read. */
export async function readPage(shopId: string, handle: string): Promise<ContentRead<PageContent>> {
  if (!PAGE_HANDLE.test(handle)) return { status: "not-found" };
  return settle(
    unstable_cache(
      () =>
        readOrThrow(shopId, `/public/pages/${encodeURIComponent(handle)}`, (body) =>
          pageOf(handle, body),
        ),
      ["online-store", shopId, "page", handle],
      { tags: [shellTag(shopId)], revalidate: CONTENT_TTL_SECONDS },
    ),
  );
}

/**
 * `GET /public/pages` for one shop, uncached (the sitemap caches its whole result): the published
 * pages with a well-formed handle and a valid date or null, at most 500. Null on any failure.
 */
export async function readPageList(shopId: string): Promise<readonly PageListItem[] | null> {
  const res = await fetchJson(shopId, "/public/pages");
  const pages = obj(res.body)?.["pages"];
  if (res.status !== 200 || !Array.isArray(pages)) return null;
  const list: PageListItem[] = [];
  for (const raw of pages) {
    if (list.length >= PAGE_LIST_MAX) break;
    const item = obj(raw);
    const handle = item?.["handle"];
    if (typeof handle !== "string" || !PAGE_HANDLE.test(handle)) continue;
    list.push({ handle, updatedAt: isoOrNull(item?.["updatedAt"]) });
  }
  return list;
}

/** This request's shop's policy. React's `cache` lets the page and its metadata share one read. */
export const getPolicy = cache(async (type: PolicyType): Promise<ContentRead<PolicyContent>> =>
  readPolicy(await currentShopId(), type),
);

/** This request's shop's page. A 404 is not cached, so the page and its metadata share one read. */
export const getPage = cache(async (handle: string): Promise<ContentRead<PageContent>> => {
  if (!PAGE_HANDLE.test(handle)) return { status: "not-found" };
  return readPage(await currentShopId(), handle);
});
