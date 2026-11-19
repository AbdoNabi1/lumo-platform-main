import { unstable_cache } from "next/cache";
import {
  CATALOG_REF_TEXT_MAX,
  CATALOG_SLUG_PATTERN,
  LINK_TARGET_ID_PATTERN,
  normalizePlainText,
  sectionDefinition,
  type FieldDescriptor,
  type PublicImage,
  type PublicSection,
  type SectionType,
} from "@platform/storefront-content";
import type { PublishedCollection, PublishedProduct } from "./catalog";
import { fetchJson } from "./content";
import { clip } from "./sanitize";
import { catalogTag, shellTag, STOREFRONT_CACHE_TTL_SECONDS } from "./shell-tag";

/**
 * Part 3 (spec 3.6, Ruling 15): the catalog data the homepage's sections show. Live catalog data
 * only, never draft, so preview uses the same cache. Each read takes the shop EXPLICITLY (never
 * `headers()`), is cached 60 s per shop under `os:` and `catalog:`, and THROWS on any failure, so
 * a failure is never stored. `loadSectionData` turns a section's failure into `"error"`: that
 * section is omitted, and the page still renders (Ruling 14).
 */

/** A collection card's data: `productCount` is null when the collections list does not name it. */
export interface HomeCollection {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly productCount: number | null;
  readonly image: PublicImage | null;
}

export type SectionData =
  | { readonly kind: "products"; readonly products: readonly PublishedProduct[] }
  | { readonly kind: "collections"; readonly collections: readonly HomeCollection[] }
  | { readonly kind: "none" };

/** `GET /public/collections` answers at most this many in one page (the Runtime's page size). */
const COLLECTIONS_FIRST = 100;
const NONE: SectionData = Object.freeze({ kind: "none" });

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fieldOf(type: SectionType, key: string): FieldDescriptor {
  const field = sectionDefinition(type)?.fields.find((f) => f.key === key);
  if (field === undefined) throw new Error(`storefront section data: no field ${type}.${key}`);
  return field;
}

/** By ids: at most what the `products` field allows (F12: from its descriptor, not a literal). */
const PRODUCTS_FIELD = fieldOf("featured_products", "products");
const BY_IDS_MAX = PRODUCTS_FIELD.kind === "products" ? PRODUCTS_FIELD.max : 0;
/** A product count: the `count` field's range (`featured_collection.productCount` is the same). */
const COUNT_FIELD = fieldOf("featured_products", "count");

function checkCount(count: number): void {
  const ok =
    COUNT_FIELD.kind === "number" &&
    Number.isInteger(count) &&
    count >= COUNT_FIELD.min &&
    count <= COUNT_FIELD.max;
  if (!ok) throw new Error("storefront section data: count out of range");
}

const isCatalogSlug = (slug: unknown): slug is string =>
  typeof slug === "string" &&
  slug.length <= CATALOG_REF_TEXT_MAX &&
  CATALOG_SLUG_PATTERN.test(slug);

/** One cached read of one shop: the shop is in the key AND in both tags (Review Focus 4). */
function cached<T>(shopId: string, tail: readonly string[], read: () => Promise<T>): Promise<T> {
  return unstable_cache(read, ["online-store", shopId, "section-data", ...tail], {
    tags: [shellTag(shopId), catalogTag(shopId)],
    revalidate: STOREFRONT_CACHE_TTL_SECONDS,
  })();
}

/** A 200 whose body is a page (`{ items: [...] }`), else a throw (inside the cache: not stored). */
async function readItems(shopId: string, path: string): Promise<unknown[]> {
  const res = await fetchJson(shopId, path);
  const items = isRecord(res.body) ? res.body["items"] : undefined;
  if (res.status !== 200 || !Array.isArray(items)) {
    throw new Error(`storefront section data read failed (${res.status})`);
  }
  return items as unknown[];
}

/** Published, with the fields a card needs and a catalog slug to link to (F5). */
function publishedProducts(items: readonly unknown[]): PublishedProduct[] {
  return items.filter(
    (item): item is PublishedProduct =>
      isRecord(item) &&
      item["status"] === "published" &&
      typeof item["id"] === "string" &&
      typeof item["name"] === "string" &&
      Array.isArray(item["variants"]) &&
      isCatalogSlug(item["slug"]),
  );
}

/** `GET /public/products?sort=newest&first=<count>`: the newest published products. */
export async function readNewestProducts(
  shopId: string,
  count: number,
): Promise<readonly PublishedProduct[]> {
  checkCount(count);
  return cached(shopId, ["newest", String(count)], async () =>
    publishedProducts(await readItems(shopId, `/public/products?sort=newest&first=${count}`)).slice(
      0,
      count,
    ),
  );
}

/**
 * `GET /public/products?ids=…`: the listed products among `ids`, in `ids` order. No ids is no
 * read; a malformed, duplicated or over-long list is refused whole (never cut, never fetched).
 */
export async function readProductsByIds(
  shopId: string,
  ids: readonly string[],
): Promise<readonly PublishedProduct[]> {
  if (ids.length === 0) return [];
  if (
    ids.length > BY_IDS_MAX ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => LINK_TARGET_ID_PATTERN.test(id))
  ) {
    throw new Error("storefront section data: invalid product ids");
  }
  const joined = ids.join(",");
  return cached(shopId, ["by-ids", joined], async () => {
    const found = new Map<string, PublishedProduct>();
    for (const product of publishedProducts(
      await readItems(shopId, `/public/products?ids=${joined}`),
    )) {
      if (!found.has(product.id)) found.set(product.id, product);
    }
    return ids.flatMap((id) => found.get(id) ?? []).slice(0, ids.length);
  });
}

/** `GET /public/collections/<slug>/products?first=<count>`: a collection's published products. */
export async function readCollectionProducts(
  shopId: string,
  slug: string,
  count: number,
): Promise<readonly PublishedProduct[]> {
  if (!isCatalogSlug(slug)) throw new Error("storefront section data: invalid collection slug");
  checkCount(count);
  return cached(shopId, ["collection", slug, String(count)], async () =>
    publishedProducts(
      await readItems(
        shopId,
        `/public/collections/${encodeURIComponent(slug)}/products?first=${count}`,
      ),
    ).slice(0, count),
  );
}

/** `GET /public/collections?first=100`: published collections with a catalog slug (F5), rebuilt. */
export async function readPublishedCollections(
  shopId: string,
): Promise<readonly PublishedCollection[]> {
  return cached(shopId, ["collections"], async () => {
    const items = await readItems(shopId, `/public/collections?first=${COLLECTIONS_FIRST}`);
    return items.slice(0, COLLECTIONS_FIRST).flatMap((item): PublishedCollection[] => {
      if (!isRecord(item) || item["status"] !== "published") return [];
      const { id, name, slug, productIds } = item;
      if (typeof id !== "string" || !LINK_TARGET_ID_PATTERN.test(id)) return [];
      if (typeof name !== "string" || !isCatalogSlug(slug)) return [];
      return [
        {
          id,
          name: clip(normalizePlainText(name), CATALOG_REF_TEXT_MAX),
          slug,
          status: "published",
          productIds: Array.isArray(productIds)
            ? productIds.filter((p): p is string => typeof p === "string")
            : [],
        },
      ];
    });
  });
}

/** One section's data. Throws when its read fails. */
async function dataFor(
  shopId: string,
  section: PublicSection,
  collections: () => Promise<readonly PublishedCollection[]>,
): Promise<SectionData> {
  if (section.incomplete === true) return NONE;
  switch (section.type) {
    case "featured_products": {
      const s = section.settings;
      const products =
        s.source === "newest"
          ? await readNewestProducts(shopId, s.count)
          : await readProductsByIds(shopId, s.productIds);
      return { kind: "products", products };
    }
    case "featured_collection": {
      const s = section.settings;
      const products = await readCollectionProducts(shopId, s.collection.slug, s.productCount);
      return { kind: "products", products };
    }
    case "collection_list": {
      const s = section.settings;
      const list = await collections();
      if (s.source === "all") {
        return {
          kind: "collections",
          collections: list.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            productCount: c.productIds.length,
            image: null,
          })),
        };
      }
      return {
        kind: "collections",
        collections: s.items.map(({ collection, image }) => {
          const listed = list.find((c) => c.id === collection.id);
          return listed === undefined
            ? { ...collection, productCount: null, image }
            : {
                id: listed.id,
                slug: listed.slug,
                name: listed.name,
                productCount: listed.productIds.length,
                image,
              };
        }),
      };
    }
    default:
      return NONE;
  }
}

/**
 * Every section's data, read in parallel. A failed read is `"error"` for that section only, logged
 * with the shop and the section type, never merchant text (spec 3.6). Sections that show no
 * catalog data (and preview placeholders) are `{ kind: "none" }` without a read.
 *
 * A manual products grid whose `?ids=` answer is empty (unlisted-only picks) is
 * `{ kind: "products", products: [] }`: the renderer omits it live (T6 carry).
 */
export async function loadSectionData(
  shopId: string,
  sections: readonly PublicSection[],
): Promise<ReadonlyMap<string, SectionData | "error">> {
  let collectionsRead: Promise<readonly PublishedCollection[]> | undefined;
  const collections = (): Promise<readonly PublishedCollection[]> => {
    collectionsRead ??= readPublishedCollections(shopId);
    return collectionsRead;
  };
  const entries = await Promise.all(
    sections.map(async (section): Promise<[string, SectionData | "error"]> => {
      try {
        return [section.id, await dataFor(shopId, section, collections)];
      } catch {
        console.warn("storefront home: section data unavailable", { shopId, type: section.type });
        return [section.id, "error"];
      }
    }),
  );
  return new Map(entries);
}
