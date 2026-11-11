import { cache } from "react";
import { unstable_cache } from "next/cache";
import { DEFAULT_HOMEPAGE_SECTIONS, type PublicSection } from "@platform/storefront-content";
import { fetchJson } from "./content";
import { readPublicSection, readPublicSections } from "./public-sections";
import { currentShopId } from "./runtime-api";
import { catalogTag, shellTag, STOREFRONT_CACHE_TTL_SECONDS } from "./shell-tag";

/**
 * Part 3 (spec 3.4, 3.6): the homepage's sections as the Runtime resolved them, re-validated here.
 * Live is cached 60 s per shop under `os:` and `catalog:` (Ruling 15); preview is `no-store` and is
 * never cached, so one viewer's draft never reaches another. A failed home read renders
 * `DEFAULT_HOME` and is never stored (Ruling 14).
 *
 * Next 15 refuses `headers()` inside `unstable_cache`: `getHomepage` resolves the shop OUTSIDE the
 * cache, and the cached function only takes `shopId` (`fetchJson` is shop-explicit).
 */

export interface StorefrontHome {
  readonly mode: "live" | "preview";
  readonly sections: readonly PublicSection[];
}

const HOME_PATH = "/public/online-store/home";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * The public form of `DEFAULT_HOMEPAGE_SECTIONS` (newest products, then all collections): it names
 * no reference, so it renders without the Runtime's resolution. Built through the same reader.
 */
export const DEFAULT_HOME: StorefrontHome = deepFreeze({
  mode: "live",
  sections: DEFAULT_HOMEPAGE_SECTIONS.flatMap((section) => {
    const read = readPublicSection(
      { id: section.id, type: section.type, settings: structuredClone(section.settings) },
      "live",
    );
    return read === null ? [] : [read];
  }),
});

/**
 * Null when the body is not a usable home of the requested mode: not an object, labelled with
 * another `mode` (read from the RESPONSE, as `parseShell` does), or without a `sections` list.
 */
export function parseHome(raw: unknown, mode: "live" | "preview"): StorefrontHome | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (body["mode"] !== mode || !Array.isArray(body["sections"])) return null;
  return { mode, sections: readPublicSections(body["sections"], mode) };
}

/** A failed read and an unusable body both throw inside the cached function: neither is stored. */
function cachedLiveHome(shopId: string): Promise<StorefrontHome> {
  return unstable_cache(
    async () => {
      const res = await fetchJson(shopId, HOME_PATH);
      if (res.status !== 200) throw new Error(`storefront home read failed (${res.status})`);
      const home = parseHome(res.body, "live");
      if (home === null) throw new Error("storefront home read returned no usable body");
      return home;
    },
    ["online-store", shopId, "home"],
    { tags: [shellTag(shopId), catalogTag(shopId)], revalidate: STOREFRONT_CACHE_TTL_SECONDS },
  )();
}

/**
 * Live (cached) or preview (`no-store`, uncached). A preview read that is refused (401), fails, or
 * answers with a body that is not a preview gives the live home. React's `cache` shares one read
 * between the page and its metadata within a request only.
 */
export const getHomepage = cache(async (previewToken: string | null): Promise<StorefrontHome> => {
  const shopId = await currentShopId();
  const live = async (): Promise<StorefrontHome> => {
    try {
      return await cachedLiveHome(shopId);
    } catch {
      return DEFAULT_HOME;
    }
  };
  if (previewToken === null) return live();
  const res = await fetchJson(shopId, HOME_PATH, { "x-preview-token": previewToken });
  const preview = res.status === 200 ? parseHome(res.body, "preview") : null;
  return preview ?? live();
});
