import { Money, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Brand } from "../domain/brand";
import { Category } from "../domain/category";
import { Collection, type CollectionStatus } from "../domain/collection";
import { Product } from "../domain/product";
import { BrandRef } from "../domain/value-objects/brand-ref";
import { CategoryRef } from "../domain/value-objects/category-ref";
import { MediaRef } from "../domain/value-objects/media-ref";
import { ProductOption } from "../domain/value-objects/product-option";
import { PublishState, type PublishStateValue } from "../domain/value-objects/publish-state";
import { Seo } from "../domain/value-objects/seo";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { VariantSelection } from "../domain/value-objects/variant-selection";
import { Variant } from "../domain/variant";

export interface ProductRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly publishState: string;
  readonly scheduledAt: Date | null;
  readonly brandId: string | null;
  readonly categoryRefs: readonly string[];
  readonly options: readonly { readonly name: string; readonly values: readonly string[] }[];
  readonly seo: { readonly title?: string; readonly description?: string } | null;
  readonly mediaRefs: readonly string[];
  readonly deletedAt: Date | null;
  readonly version: number;
}
export interface VariantRow {
  readonly id: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  readonly selection: Readonly<Record<string, string>> | null;
}
export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly deletedAt: Date | null;
  readonly version: number;
}
export interface BrandRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly deletedAt: Date | null;
  readonly version: number;
}
export interface CollectionRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly deletedAt: Date | null;
  readonly version: number;
}
/** One row of the `CollectionItem` join table — `position` carries manual ordering. */
export interface CollectionItemRow {
  readonly productId: string;
  readonly position: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt catalog row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link Product}. Mapping only — no I/O. */
export class ProductMapper {
  static toDomain(row: ProductRow, variants: readonly VariantRow[]): Product {
    return Product.reconstitute(
      UniqueEntityId.from(row.id),
      must(Sku.create(row.sku), "sku"),
      row.name,
      must(Slug.create(row.slug), "slug"),
      PublishState.from(row.publishState as PublishStateValue),
      row.scheduledAt,
      row.brandId === null ? null : must(BrandRef.create(row.brandId), "brand ref"),
      row.categoryRefs.map((id) => must(CategoryRef.create(id), "category ref")),
      row.options.map((o) => must(ProductOption.create(o.name, o.values), "product option")),
      row.seo === null ? null : must(Seo.create(row.seo.title, row.seo.description), "seo"),
      variants.map((v) =>
        Variant.create(
          UniqueEntityId.from(v.id),
          must(Sku.create(v.sku), "variant sku"),
          must(Money.create(v.priceAmountMinor, v.currency), "variant price"),
          v.selection === null
            ? null
            : must(VariantSelection.create(v.selection), "variant selection"),
        ),
      ),
      row.mediaRefs.map((assetId) => must(MediaRef.create(assetId), "media ref")),
      row.deletedAt !== null,
      row.version,
    );
  }

  static toProductRow(product: Product, tenantId: string) {
    return {
      id: product.id.toString(),
      tenantId,
      sku: product.sku.value,
      name: product.name,
      slug: product.slug.value,
      publishState: product.status.value,
      scheduledAt: product.scheduledAt,
      brandId: product.brand?.brandId ?? null,
      categoryRefs: product.categories.map((c) => c.categoryId),
      options: product.options.map((o) => ({ name: o.name, values: [...o.values] })),
      seo:
        product.seo === null
          ? null
          : {
              title: product.seo.title ?? undefined,
              description: product.seo.description ?? undefined,
            },
      mediaRefs: product.media.map((m) => m.assetId),
      deletedAt: product.deleted ? new Date() : null,
      version: 1,
    };
  }

  static toVariantRows(product: Product, tenantId: string) {
    return product.variants.map((v) => ({
      id: v.id.toString(),
      tenantId,
      productId: product.id.toString(),
      sku: v.sku.value,
      priceAmountMinor: v.price.amountMinor,
      currency: v.price.currency,
      selection: v.selection === null ? null : { ...v.selection.values },
    }));
  }
}

/** Persistence ↔ aggregate mapping for {@link Category}. Mapping only — no I/O. */
export class CategoryMapper {
  static toDomain(row: CategoryRow): Category {
    return Category.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      must(Slug.create(row.slug), "slug"),
      row.parentId,
      row.deletedAt !== null,
      row.version,
    );
  }

  static toRow(category: Category, tenantId: string) {
    return {
      id: category.id.toString(),
      tenantId,
      name: category.name,
      slug: category.slug.value,
      parentId: category.parentId,
      deletedAt: category.deleted ? new Date() : null,
      version: 1,
    };
  }
}

/** Persistence ↔ aggregate mapping for {@link Brand}. Mapping only — no I/O. */
export class BrandMapper {
  static toDomain(row: BrandRow): Brand {
    return Brand.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      must(Slug.create(row.slug), "slug"),
      row.deletedAt !== null,
      row.version,
    );
  }

  static toRow(brand: Brand, tenantId: string) {
    return {
      id: brand.id.toString(),
      tenantId,
      name: brand.name,
      slug: brand.slug.value,
      deletedAt: brand.deleted ? new Date() : null,
      version: 1,
    };
  }
}

/** Persistence ↔ aggregate mapping for {@link Collection}. Mapping only — no I/O. */
export class CollectionMapper {
  static toDomain(row: CollectionRow, items: readonly CollectionItemRow[]): Collection {
    const ordered = [...items].sort((a, b) => a.position - b.position).map((i) => i.productId);
    return Collection.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      must(Slug.create(row.slug), "slug"),
      row.status as CollectionStatus,
      ordered,
      row.deletedAt !== null,
      row.version,
    );
  }

  static toRow(collection: Collection, tenantId: string) {
    return {
      id: collection.id.toString(),
      tenantId,
      name: collection.name,
      slug: collection.slug.value,
      status: collection.status,
      deletedAt: collection.deleted ? new Date() : null,
      version: 1,
    };
  }

  static toItemRows(collection: Collection, tenantId: string) {
    return collection.productIds.map((productId, index) => ({
      collectionId: collection.id.toString(),
      tenantId,
      productId,
      position: index,
    }));
  }
}
