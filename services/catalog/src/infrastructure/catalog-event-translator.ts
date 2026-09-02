import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { BrandCreated } from "../domain/events/brand-created.event";
import { BrandDeleted } from "../domain/events/brand-deleted.event";
import { BrandUpdated } from "../domain/events/brand-updated.event";
import { CategoryCreated } from "../domain/events/category-created.event";
import { CategoryDeleted } from "../domain/events/category-deleted.event";
import { CategoryMoved } from "../domain/events/category-moved.event";
import { CollectionCreated } from "../domain/events/collection-created.event";
import { CollectionDeleted } from "../domain/events/collection-deleted.event";
import { CollectionProductAdded } from "../domain/events/collection-product-added.event";
import { CollectionProductRemoved } from "../domain/events/collection-product-removed.event";
import { CollectionProductsReordered } from "../domain/events/collection-products-reordered.event";
import { CollectionPublished } from "../domain/events/collection-published.event";
import { CollectionRenamed } from "../domain/events/collection-renamed.event";
import { CollectionUnpublished } from "../domain/events/collection-unpublished.event";
import { ProductArchived } from "../domain/events/product-archived.event";
import { ProductCategorized } from "../domain/events/product-categorized.event";
import { ProductCreated } from "../domain/events/product-created.event";
import { ProductDeleted } from "../domain/events/product-deleted.event";
import { ProductMediaAttached } from "../domain/events/product-media-attached.event";
import { ProductMediaDetached } from "../domain/events/product-media-detached.event";
import { ProductMediaReordered } from "../domain/events/product-media-reordered.event";
import { ProductPublished } from "../domain/events/product-published.event";
import { ProductUnpublished } from "../domain/events/product-unpublished.event";
import { ProductUpdated } from "../domain/events/product-updated.event";
import { ProductVariantAdded } from "../domain/events/product-variant-added.event";
import { ProductVariantRemoved } from "../domain/events/product-variant-removed.event";
import { ProductVariantUpdated } from "../domain/events/product-variant-updated.event";

/** Every integration event type this translator can produce, across all four provenance layers. */
export const CATALOG_PUBLISHED_EVENTS = [
  "catalog.product.created",
  "catalog.product.published",
  "catalog.product.updated",
  "catalog.product.unpublished",
  "catalog.product.archived",
  "catalog.product.deleted",
  "catalog.product.variant_added",
  "catalog.product.variant_removed",
  "catalog.product.variant_updated",
  "catalog.product.categorized",
  "catalog.product.media_attached",
  "catalog.product.media_detached",
  "catalog.product.media_reordered",
  "catalog.brand.created",
  "catalog.brand.updated",
  "catalog.brand.deleted",
  "catalog.category.created",
  "catalog.category.moved",
  "catalog.category.deleted",
  "catalog.collection.created",
  "catalog.collection.renamed",
  "catalog.collection.product_added",
  "catalog.collection.product_removed",
  "catalog.collection.products_reordered",
  "catalog.collection.published",
  "catalog.collection.unpublished",
  "catalog.collection.deleted",
] as const;

/** Maps Catalog domain events to integration events (keeps the domain pure). */
export class CatalogEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ProductCreated) {
      return descriptor("catalog.product.created", "product", event.data);
    }
    if (event instanceof ProductPublished) {
      return descriptor("catalog.product.published", "product", event.data);
    }
    if (event instanceof ProductUpdated) {
      return descriptor("catalog.product.updated", "product", event.data);
    }
    if (event instanceof ProductUnpublished) {
      return descriptor("catalog.product.unpublished", "product", event.data);
    }
    if (event instanceof ProductArchived) {
      return descriptor("catalog.product.archived", "product", event.data);
    }
    if (event instanceof ProductDeleted) {
      return descriptor("catalog.product.deleted", "product", event.data);
    }
    if (event instanceof ProductVariantAdded) {
      return descriptor("catalog.product.variant_added", "product", event.data);
    }
    if (event instanceof ProductVariantRemoved) {
      return descriptor("catalog.product.variant_removed", "product", event.data);
    }
    if (event instanceof ProductVariantUpdated) {
      return descriptor("catalog.product.variant_updated", "product", event.data);
    }
    if (event instanceof ProductCategorized) {
      return descriptor("catalog.product.categorized", "product", event.data);
    }
    if (event instanceof ProductMediaAttached) {
      return descriptor("catalog.product.media_attached", "product", event.data);
    }
    if (event instanceof ProductMediaDetached) {
      return descriptor("catalog.product.media_detached", "product", event.data);
    }
    if (event instanceof ProductMediaReordered) {
      return descriptor("catalog.product.media_reordered", "product", event.data);
    }
    if (event instanceof BrandCreated) {
      return descriptor("catalog.brand.created", "brand", event.data);
    }
    if (event instanceof BrandUpdated) {
      return descriptor("catalog.brand.updated", "brand", event.data);
    }
    if (event instanceof BrandDeleted) {
      return descriptor("catalog.brand.deleted", "brand", event.data);
    }
    if (event instanceof CategoryCreated) {
      return descriptor("catalog.category.created", "category", event.data);
    }
    if (event instanceof CategoryMoved) {
      return descriptor("catalog.category.moved", "category", event.data);
    }
    if (event instanceof CategoryDeleted) {
      return descriptor("catalog.category.deleted", "category", event.data);
    }
    if (event instanceof CollectionCreated) {
      return descriptor("catalog.collection.created", "collection", event.data);
    }
    if (event instanceof CollectionRenamed) {
      return descriptor("catalog.collection.renamed", "collection", event.data);
    }
    if (event instanceof CollectionProductAdded) {
      return descriptor("catalog.collection.product_added", "collection", event.data);
    }
    if (event instanceof CollectionProductRemoved) {
      return descriptor("catalog.collection.product_removed", "collection", event.data);
    }
    if (event instanceof CollectionProductsReordered) {
      return descriptor("catalog.collection.products_reordered", "collection", event.data);
    }
    if (event instanceof CollectionPublished) {
      return descriptor("catalog.collection.published", "collection", event.data);
    }
    if (event instanceof CollectionUnpublished) {
      return descriptor("catalog.collection.unpublished", "collection", event.data);
    }
    if (event instanceof CollectionDeleted) {
      return descriptor("catalog.collection.deleted", "collection", event.data);
    }
    return undefined;
  }
}

function descriptor(
  type: string,
  aggregateType: string,
  payload: object,
): IntegrationEventDescriptor {
  return { type, eventVersion: 1, aggregateType, payload: payload };
}
