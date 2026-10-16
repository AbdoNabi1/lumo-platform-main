import type { Product } from "@platform/catalog";
import type { RouteDefinition } from "@platform/http";
import type { ResolvedImage } from "@platform/media";
import type { Paginated } from "@platform/types";
import { logger } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { PageResponse } from "./public-catalog-routes";

/**
 * Plan 2C-3: how product, order, cart and checkout readers get their pictures. Every function here
 * either works on an already-loaded index or does ONE read for the whole response, never one per row:
 * media ids are collected first, resolved together by `admin.mediaImages` (one tenant-scoped query),
 * and then looked up in the returned map. An image that is missing, archived or another tenant's is
 * simply absent from the map, so no read can fail because of a picture.
 */

/** What a reader sees of an image: `{ id, url, alt, width, height }`. No storage key. */
export type ImageDto = ResolvedImage;
export type ImageIndex = ReadonlyMap<string, ResolvedImage>;

type VariantLike = Product["variants"][number];

export interface LoadImagesOptions {
  /** How many of each product's pictures to resolve (lists need the first two; a detail page needs all). */
  readonly perProduct: number;
  /** Also resolve each variant's own image. */
  readonly variants: boolean;
}

/** Every picture of a product (its detail page). */
export const ALL_MEDIA = Number.MAX_SAFE_INTEGER;

/**
 * Lists resolve the first few pictures per product, enough to name a featured and a hover image even
 * if the first one went missing, without pulling a 30-picture product's whole gallery into a 50-row page.
 */
export const LIST_MEDIA = 4;

/** ONE call to Media for all the pictures the given products need. */
export async function loadImages(
  admin: Pick<WiredAdmin, "mediaImages">,
  tenantId: string,
  products: readonly Product[],
  options: LoadImagesOptions,
): Promise<ImageIndex> {
  const ids = new Set<string>();
  for (const product of products) {
    for (const media of product.media.slice(0, options.perProduct)) ids.add(media.assetId);
    if (options.variants) {
      for (const variant of product.variants) {
        if (variant.mediaRef !== null) ids.add(variant.mediaRef);
      }
    }
  }
  if (ids.size === 0) return new Map();
  try {
    return await admin.mediaImages.execute({ ids: [...ids], tenantId });
  } catch (error) {
    // A picture is never worth failing the page for: show the placeholders and say why in the log.
    logger.warn("product images unavailable", { tenantId, error: describe(error) });
    return new Map();
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The product's pictures in the merchant's order, skipping any that did not resolve. */
export function productMedia(product: Product, images: ImageIndex): ImageDto[] {
  const result: ImageDto[] = [];
  for (const media of product.media) {
    const image = images.get(media.assetId);
    if (image !== undefined) result.push(image);
  }
  return result;
}

/** The first picture (Shopify's "featured image"), or `null` when the product has none. */
export function featuredImageOf(product: Product, images: ImageIndex): ImageDto | null {
  return productMedia(product, images)[0] ?? null;
}

/** The second picture, shown when a shopper hovers a product card. */
export function hoverImageOf(product: Product, images: ImageIndex): ImageDto | null {
  return productMedia(product, images)[1] ?? null;
}

/** The variant's image id, only when that image resolved (so a client never points at a ghost). */
export function variantImageIdOf(variant: VariantLike, images: ImageIndex): string | null {
  return variant.mediaRef !== null && images.has(variant.mediaRef) ? variant.mediaRef : null;
}

export interface LineRef {
  readonly productId: string;
  readonly variantId: string | null;
}

export const lineKey = (productId: string, variantId: string | null): string =>
  `${productId}:${variantId ?? ""}`;

/**
 * The picture for each order / cart / checkout line: the variant's own image, else the product's
 * featured image, resolved NOW (a line stores no image, so editing the product's pictures updates old
 * orders' thumbnails). A product deleted since — or one never found — gives `null` (the placeholder).
 * Two reads in all, however many lines: the distinct products, then their pictures.
 */
export async function resolveLineImages(
  admin: Pick<WiredAdmin, "mediaImages" | "publicReads">,
  tenantId: string,
  lines: readonly LineRef[],
): Promise<ReadonlyMap<string, ImageDto | null>> {
  try {
    return await resolveLineImagesOrThrow(admin, tenantId, lines);
  } catch (error) {
    logger.warn("line images unavailable", { tenantId, error: describe(error) });
    return new Map();
  }
}

async function resolveLineImagesOrThrow(
  admin: Pick<WiredAdmin, "mediaImages" | "publicReads">,
  tenantId: string,
  lines: readonly LineRef[],
): Promise<ReadonlyMap<string, ImageDto | null>> {
  const result = new Map<string, ImageDto | null>();
  if (lines.length === 0) return result;

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const response = await admin.publicReads.products.getByIds({ ids: productIds, tenantId });
  const products = response.status === 200 ? (response.body as readonly Product[]) : [];
  const byId = new Map(products.map((product) => [product.id.toString(), product]));

  // candidates per line, best first: the variant's image, then the product's own in order
  const candidates = new Map<string, string[]>();
  const wanted = new Set<string>();
  for (const line of lines) {
    const product = byId.get(line.productId);
    const ids: string[] = [];
    if (product !== undefined) {
      const variant = product.variants.find((v) => v.id.toString() === line.variantId);
      if (variant?.mediaRef != null) ids.push(variant.mediaRef);
      for (const media of product.media) ids.push(media.assetId);
    }
    candidates.set(lineKey(line.productId, line.variantId), ids);
    for (const id of ids) wanted.add(id);
  }

  const images: ImageIndex =
    wanted.size === 0 ? new Map() : await admin.mediaImages.execute({ ids: [...wanted], tenantId });
  for (const [key, ids] of candidates) {
    const first = ids.find((id) => images.has(id));
    result.set(key, first === undefined ? null : (images.get(first) ?? null));
  }
  return result;
}

/** Projects a controller's `Paginated<Product>` through `toDto`, resolving the page's pictures in ONE read. */
export async function mapProductPage<TDto>(
  admin: Pick<WiredAdmin, "mediaImages">,
  tenantId: string,
  response: PageResponse,
  options: LoadImagesOptions,
  toDto: (product: Product, images: ImageIndex) => TDto,
): Promise<PageResponse> {
  if (response.status < 200 || response.status >= 300) return response;
  const page = response.body as Paginated<Product>;
  const images = await loadImages(admin, tenantId, page.items, options);
  return {
    status: response.status,
    body: { items: page.items.map((product) => toDto(product, images)), pageInfo: page.pageInfo },
  };
}

interface LineLike {
  readonly productId: string;
  readonly variantId?: string | null;
}

const isLine = (value: unknown): value is LineLike =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { productId?: unknown }).productId === "string";

const hasLines = (value: unknown): value is { items: LineLike[] } =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { items?: unknown }).items) &&
  (value as { items: unknown[] }).items.every(isLine);

/**
 * Adds `imageUrl` to every line of a cart or checkout response (`{ items }` or `{ cart: { items } }`),
 * with ONE product read and ONE picture read for all the lines. Wrapping the route list once means the
 * twenty-odd cart and checkout routes each return the same shape without each knowing about pictures.
 * Anything else (errors, bodies without lines) passes through untouched.
 */
export function withLineImages(
  admin: Pick<WiredAdmin, "mediaImages" | "publicReads">,
  routes: readonly RouteDefinition[],
): readonly RouteDefinition[] {
  const decorate = async (body: unknown, tenantId: string): Promise<unknown> => {
    const target = hasLines(body)
      ? body
      : typeof body === "object" && body !== null && hasLines((body as { cart?: unknown }).cart)
        ? (body as { cart: { items: LineLike[] } }).cart
        : null;
    if (target === null) return body;
    const lines = await resolveLineImages(
      admin,
      tenantId,
      target.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
      })),
    );
    const withImages = {
      ...target,
      items: target.items.map((item) => ({
        ...item,
        imageUrl: lines.get(lineKey(item.productId, item.variantId ?? null))?.url ?? null,
      })),
    };
    return target === body ? withImages : { ...(body as object), cart: withImages };
  };

  return routes.map((route): RouteDefinition => ({
    ...route,
    handle: async (input) => {
      const response = await route.handle(input);
      if (response.status < 200 || response.status >= 300) return response;
      return { ...response, body: await decorate(response.body, input.context.tenantId) };
    },
  }));
}
