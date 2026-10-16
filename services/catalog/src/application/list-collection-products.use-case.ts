import type { UseCase } from "@platform/application";
import { decodeCursor, encodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface ListCollectionProductsInput extends CursorPage {
  readonly slug: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListCollectionProductsDeps {
  readonly collections: CollectionRepository;
  readonly products: ProductRepository;
}

/**
 * Paginated, published-only products belonging to one collection, in the collection's own
 * curated order (T5.20 — replaces the storefront's former "fetch the collection plus the whole
 * catalog's first 100 products and intersect client-side" workaround, which silently dropped any
 * member beyond that first page).
 *
 * There is no repository-level "products in this collection" query: `ProductRepository` only has
 * single-item `findById`, and `Collection` only stores an ordered `productIds` array (Sprint 7.0
 * §12 — manually curated, no rule-based evaluation). So this use case paginates over that array
 * itself, BY INDEX — the cursor is the stringified array index of the last row the page consumed,
 * round-tripped through `@platform/repository`'s `encodeCursor`/`decodeCursor` (both the identity
 * function today, same as every other cursor in this codebase; callers must still treat it as
 * opaque). It then bulk-resolves that page's slice of ids via parallel `ProductRepository.findById`
 * calls (`Promise.all`, bounded by the page size — same `normalizePageSize` ceiling every other
 * list use case in this package uses).
 *
 * Two kinds of rows are silently dropped from the resolved page rather than erroring the whole
 * request: an id that no longer resolves (the product was deleted after being added to the
 * collection) and a product that resolves but isn't published (the public surface must never leak
 * a draft/scheduled/archived product, same rule `publishedOnly` enforces for
 * `/public/prices` in `apps/admin/src/http/public-catalog-routes.ts`). Both are computed AFTER the
 * index slice, so `pageInfo` describes the raw, unfiltered slice of `productIds` — a page can come
 * back with fewer items than `first` while `hasNextPage` is still true. That is the same contract
 * `publishedOnly` documents; callers must follow the cursor, not infer "that's everything" from a
 * short page.
 */
export class ListCollectionProducts implements UseCase<
  ListCollectionProductsInput,
  Paginated<Product>,
  DomainError
> {
  private readonly deps: ListCollectionProductsDeps;

  constructor(deps: ListCollectionProductsDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListCollectionProductsInput,
  ): Promise<Result<Paginated<Product>, DomainError>> {
    const { slug, tenantId, ...page } = input;
    const collection = await this.deps.collections.findBySlug(slug, tenantId);
    if (collection === null || collection.status !== "published") {
      return err(new NotFoundError("Collection not found"));
    }

    const productIds = collection.productIds;
    const decodedAfter = page.after !== undefined ? Number(decodeCursor(page.after)) : Number.NaN;
    const startIndex = Number.isInteger(decodedAfter) && decodedAfter >= 0 ? decodedAfter + 1 : 0;
    const limit = normalizePageSize(page.first);
    const slice = productIds.slice(startIndex, startIndex + limit);

    const resolved = await Promise.all(
      slice.map((id) => this.deps.products.findById(id, tenantId)),
    );
    const items = resolved.filter(
      (product): product is Product => product !== null && product.status.value === "published",
    );

    const hasNextPage = startIndex + slice.length < productIds.length;
    const endCursor = slice.length > 0 ? encodeCursor(String(startIndex + slice.length - 1)) : null;

    return ok({ items, pageInfo: { hasNextPage, endCursor } });
  }
}
