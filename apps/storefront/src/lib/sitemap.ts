import { unstable_cache } from "next/cache";
import {
  PAGE_HANDLE_PATTERN,
  pickText,
  POLICY_TYPES,
  policyPath,
  type LocalizedText,
  type PolicyType,
} from "@platform/storefront-content";
import { readPageList, readPolicy, type ContentRead } from "./content";
import {
  currentShopId,
  getCollectionsPage,
  getProductsPage,
  type CursorPageResult,
} from "./runtime-api";
import { shellTag } from "./shell-tag";

/**
 * Spec 2.8: the paths `sitemap.xml` lists for one shop: home, search, published collections,
 * published products, published `/pages/<handle>` pages and the policies that are set. At most
 * 5,000 URLs from at most 60 Runtime calls within 20 s; a failed read, or running out of time,
 * throws, so a partial answer is never cached as the shop's sitemap.
 *
 * Next writes `<loc>` and `<lastmod>` into the XML without escaping (preflight 8), so only slugs and
 * handles made of safe characters are kept, and a date only as `toISOString()` of a valid date.
 */

export const SITEMAP_MAX_URLS = 5_000;
export const SITEMAP_MAX_CALLS = 60;
/** Preflight 9: past this the collector gives up (each read also times out after 3 s). */
export const SITEMAP_BUDGET_MS = 20_000;
const SITEMAP_TTL_SECONDS = 3_600;
/** The catalog's slug rule: lower-case words joined by single hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SitemapPath {
  readonly path: string;
  readonly lastModified?: string;
}

type Page<T> = CursorPageResult<T>;
type Listed = { slug: string; status: string };

export interface SitemapReads {
  products(after?: string): Promise<Page<Listed> | null>;
  collections(after?: string): Promise<Page<Listed> | null>;
  pages(): Promise<readonly { handle: string; updatedAt: string | null }[] | null>;
  policy(
    type: PolicyType,
  ): Promise<ContentRead<{ readonly body: LocalizedText; readonly updatedAt: string | null }>>;
}

/** A valid date as an ISO string (safe in XML), else undefined. */
function isoOf(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const withDate = (path: string, updatedAt: unknown): SitemapPath => {
  const lastModified = isoOf(updatedAt);
  return lastModified === undefined ? { path } : { path, lastModified };
};

/** Pure over the injected reads (and clock). */
export async function collectSitemapPaths(
  reads: SitemapReads,
  options: { readonly now?: () => number } = {},
): Promise<readonly SitemapPath[]> {
  const now = options.now ?? Date.now;
  const started = now();
  let calls = 0;
  /** Counts one Runtime read and enforces the time budget once it answers. */
  const call = async <T>(read: () => Promise<T>): Promise<T> => {
    calls += 1;
    const result = await read();
    if (now() - started > SITEMAP_BUDGET_MS) {
      throw new Error("sitemap: time budget exceeded");
    }
    return result;
  };
  // The page list and the policies always get their calls; the catalog pages share the rest.
  const catalogCalls = SITEMAP_MAX_CALLS - 1 - POLICY_TYPES.length;
  const paths: SitemapPath[] = [{ path: "/" }, { path: "/search" }];
  const full = () => paths.length >= SITEMAP_MAX_URLS;

  const pageThrough = async (
    read: (after?: string) => Promise<Page<Listed> | null>,
    prefix: string,
  ) => {
    let after: string | undefined;
    const seen = new Set<string>();
    while (!full() && calls < catalogCalls) {
      const page = await call(() => read(after));
      if (page === null) throw new Error(`sitemap: ${prefix} read failed`);
      for (const item of page.items as readonly unknown[]) {
        if (typeof item !== "object" || item === null) continue;
        const { slug, status } = item as { slug?: unknown; status?: unknown };
        if (status !== "published" || typeof slug !== "string" || !SLUG.test(slug)) continue;
        paths.push({ path: `${prefix}${slug}` });
        if (full()) break;
      }
      const next = page.pageInfo.endCursor;
      if (!page.pageInfo.hasNextPage || next === null || seen.has(next)) break;
      seen.add(next);
      after = next;
    }
  };

  await pageThrough((after) => reads.collections(after), "/collections/");
  await pageThrough((after) => reads.products(after), "/products/");

  if (!full()) {
    const pages = await call(() => reads.pages());
    if (pages === null) throw new Error("sitemap: page list read failed");
    for (const page of pages as readonly unknown[]) {
      if (full()) break;
      if (typeof page !== "object" || page === null) continue;
      const { handle, updatedAt } = page as { handle?: unknown; updatedAt?: unknown };
      if (typeof handle !== "string" || !PAGE_HANDLE_PATTERN.test(handle)) continue;
      paths.push(withDate(`/pages/${handle}`, updatedAt));
    }
  }

  for (const type of POLICY_TYPES) {
    if (full()) break;
    const read = await call(() => reads.policy(type));
    if (read.status === "error") throw new Error(`sitemap: ${type} policy read failed`);
    // A set row with no text in either language 404s on its page (`pickText` falls back across
    // locales), so it is not listed either (task 9 review, minor 3).
    if (read.status !== "ok" || pickText(read.value.body, "en") === null) continue;
    paths.push(withDate(policyPath(type), read.value.updatedAt));
  }

  return paths.slice(0, SITEMAP_MAX_URLS);
}

/** The shop-explicit Runtime reads: none touches request headers (preflight 1). */
function liveReads(shopId: string): SitemapReads {
  return {
    products: (after) => getProductsPage(shopId, after),
    collections: (after) => getCollectionsPage(shopId, after),
    pages: () => readPageList(shopId),
    policy: (type) => readPolicy(shopId, type),
  };
}

/**
 * This request's shop's sitemap paths, cached for an hour under its key and tag. The shop is read
 * here, outside the cache: Next refuses `headers()` inside `unstable_cache` (preflight 1). A failure
 * throws inside the cached function, so it is never stored.
 */
export async function getSitemapPaths(): Promise<readonly SitemapPath[]> {
  const shopId = await currentShopId();
  return unstable_cache(
    () => collectSitemapPaths(liveReads(shopId)),
    ["online-store", shopId, "sitemap"],
    { tags: [shellTag(shopId)], revalidate: SITEMAP_TTL_SECONDS },
  )();
}
