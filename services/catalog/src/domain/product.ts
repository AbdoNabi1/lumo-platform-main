import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { ProductArchived } from "./events/product-archived.event";
import { ProductCategorized } from "./events/product-categorized.event";
import { ProductCreated } from "./events/product-created.event";
import { ProductDeleted } from "./events/product-deleted.event";
import { ProductMediaAttached } from "./events/product-media-attached.event";
import { ProductMediaDetached } from "./events/product-media-detached.event";
import { ProductMediaReordered } from "./events/product-media-reordered.event";
import { ProductPublished } from "./events/product-published.event";
import { ProductUnpublished } from "./events/product-unpublished.event";
import { ProductUpdated } from "./events/product-updated.event";
import { ProductVariantAdded } from "./events/product-variant-added.event";
import { ProductVariantRemoved } from "./events/product-variant-removed.event";
import { ProductVariantUpdated } from "./events/product-variant-updated.event";
import type { BrandRef } from "./value-objects/brand-ref";
import type { CategoryRef } from "./value-objects/category-ref";
import type { MediaRef } from "./value-objects/media-ref";
import type { ProductOption } from "./value-objects/product-option";
import { PublishState } from "./value-objects/publish-state";
import type { Seo } from "./value-objects/seo";
import type { Sku } from "./value-objects/sku";
import type { Slug } from "./value-objects/slug";
import type { Variant } from "./variant";

interface ProductProps {
  readonly sku: Sku;
  name: string;
  slug: Slug;
  status: PublishState;
  scheduledAt: Date | null;
  brand: BrandRef | null;
  categories: readonly CategoryRef[];
  options: readonly ProductOption[];
  seo: Seo | null;
  variants: Variant[];
  media: readonly MediaRef[];
  deleted: boolean;
}

export interface NewProduct {
  readonly sku: Sku;
  readonly name: string;
  readonly slug: Slug;
  readonly variants: readonly Variant[];
  readonly media?: readonly MediaRef[];
}

/**
 * Catalog product aggregate. Created as a draft; Commerce Sprint 1 added the publish/schedule/
 * unpublish/archive state machine, variant matrix, brand/category/option/seo, and Sprint 4.2
 * added the media lifecycle. `options` are mutable only while draft (Commerce Sprint 1 §invariant).
 */
export class Product extends AggregateRoot<ProductProps> {
  static create(id: UniqueEntityId, props: NewProduct, eventId: string, occurredAt: Date): Product {
    if (props.variants.length === 0) {
      throw new BusinessRuleError("A product must have at least one variant");
    }
    const product = new Product(
      {
        sku: props.sku,
        name: props.name,
        slug: props.slug,
        status: PublishState.draft(),
        scheduledAt: null,
        brand: null,
        categories: [],
        options: [],
        seo: null,
        variants: [...props.variants],
        media: props.media ?? [],
        deleted: false,
      },
      id,
    );
    product.addDomainEvent(
      new ProductCreated(
        { eventId, aggregateId: product.id, occurredAt },
        { sku: props.sku.value, name: props.name, slug: props.slug.value },
      ),
    );
    return product;
  }

  /**
   * Rebuilds a persisted product exactly as stored - no domain events raised, persisted `version`
   * carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    sku: Sku,
    name: string,
    slug: Slug,
    status: PublishState,
    scheduledAt: Date | null,
    brand: BrandRef | null,
    categories: readonly CategoryRef[],
    options: readonly ProductOption[],
    seo: Seo | null,
    variants: readonly Variant[],
    media: readonly MediaRef[],
    deleted: boolean,
    version: number,
  ): Product {
    return new Product(
      {
        sku,
        name,
        slug,
        status,
        scheduledAt,
        brand,
        categories: [...categories],
        options: [...options],
        seo,
        variants: [...variants],
        media: [...media],
        deleted,
      },
      id,
      version,
    );
  }

  publish(eventId: string, occurredAt: Date): void {
    if (this.props.status.isPublished) {
      throw new BusinessRuleError("Product is already published");
    }
    if (this.props.status.isArchived) {
      throw new BusinessRuleError("An archived product cannot be published");
    }
    if (this.props.variants.length === 0) {
      throw new BusinessRuleError("A product must have at least one variant to publish");
    }
    this.props.status = PublishState.published();
    this.props.scheduledAt = null;
    this.addDomainEvent(
      new ProductPublished(
        { eventId, aggregateId: this.id, occurredAt },
        { sku: this.props.sku.value, name: this.props.name, slug: this.props.slug.value },
      ),
    );
  }

  /**
   * Schedules a future publish. Draft-only; `scheduledAt` must be strictly after `occurredAt`.
   * No dedicated event: the approved 10-event list (Commerce Sprint 1 §4) has no "scheduled"
   * event id — a real actual publish still raises `product.published` when it later happens.
   */
  schedulePublish(scheduledAt: Date, now: Date): void {
    if (!this.props.status.isDraft) {
      throw new BusinessRuleError("Only a draft product can be scheduled");
    }
    if (scheduledAt.getTime() <= now.getTime()) {
      throw new BusinessRuleError("Scheduled publish time must be in the future");
    }
    this.props.status = PublishState.scheduled();
    this.props.scheduledAt = scheduledAt;
  }

  unpublish(eventId: string, occurredAt: Date): void {
    if (!this.props.status.isPublished) {
      throw new BusinessRuleError("Only a published product can be unpublished");
    }
    this.props.status = PublishState.draft();
    this.addDomainEvent(
      new ProductUnpublished(
        { eventId, aggregateId: this.id, occurredAt },
        { sku: this.props.sku.value },
      ),
    );
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status.isArchived) {
      throw new BusinessRuleError("Product is already archived");
    }
    this.props.status = PublishState.archived();
    this.addDomainEvent(
      new ProductArchived(
        { eventId, aggregateId: this.id, occurredAt },
        { sku: this.props.sku.value },
      ),
    );
  }

  update(name: string, slug: Slug, eventId: string, occurredAt: Date): void {
    this.props.name = name;
    this.props.slug = slug;
    this.addDomainEvent(
      new ProductUpdated({ eventId, aggregateId: this.id, occurredAt }, { name, slug: slug.value }),
    );
  }

  /** Adds a variant to the matrix — unique SKU, unique selection, selection consistent with `options`. */
  addVariant(variant: Variant, eventId: string, occurredAt: Date): void {
    if (this.props.variants.some((v) => v.sku.value === variant.sku.value)) {
      throw new BusinessRuleError(`Duplicate variant SKU: ${variant.sku.value}`);
    }
    const selection = variant.selection;
    if (selection !== null) {
      for (const [optionName, value] of Object.entries(selection.values)) {
        const option = this.props.options.find((o) => o.name === optionName);
        if (!option || !option.values.includes(value)) {
          throw new BusinessRuleError(
            `Variant selection ${optionName}=${value} does not match a declared product option`,
          );
        }
      }
      if (this.props.variants.some((v) => v.selection !== null && v.selection.matches(selection))) {
        throw new BusinessRuleError("Another variant already has this exact option selection");
      }
    }
    this.props.variants.push(variant);
    this.addDomainEvent(
      new ProductVariantAdded(
        { eventId, aggregateId: this.id, occurredAt },
        {
          sku: this.props.sku.value,
          variantId: variant.id.toString(),
          variantSku: variant.sku.value,
        },
      ),
    );
  }

  /** Removes a variant — at least one must remain. */
  removeVariant(variantId: string, eventId: string, occurredAt: Date): void {
    if (this.props.variants.length <= 1) {
      throw new BusinessRuleError("A product must retain at least one variant");
    }
    const index = this.props.variants.findIndex((v) => v.id.toString() === variantId);
    if (index === -1) {
      throw new BusinessRuleError(`Variant not found: ${variantId}`);
    }
    this.props.variants.splice(index, 1);
    this.addDomainEvent(
      new ProductVariantRemoved(
        { eventId, aggregateId: this.id, occurredAt },
        { sku: this.props.sku.value, variantId },
      ),
    );
  }

  /**
   * In-place sku/price edit for an existing variant (Sprint 7.0 `UpdateVariant`) — `selection`
   * never changes (mutating it could silently violate the unique-selection invariant above).
   */
  updateVariant(
    variantId: string,
    sku: Sku,
    price: Variant["price"],
    eventId: string,
    occurredAt: Date,
  ): void {
    const variant = this.props.variants.find((v) => v.id.toString() === variantId);
    if (!variant) {
      throw new BusinessRuleError(`Variant not found: ${variantId}`);
    }
    if (
      this.props.variants.some((v) => v.id.toString() !== variantId && v.sku.value === sku.value)
    ) {
      throw new BusinessRuleError(`Duplicate variant SKU: ${sku.value}`);
    }
    variant.update(sku, price);
    this.addDomainEvent(
      new ProductVariantUpdated({ eventId, aggregateId: this.id, occurredAt }, { variantId }),
    );
  }

  /** Replaces the declared option set. Mutable only while draft (no event — internal config). */
  setOptions(options: readonly ProductOption[]): void {
    if (!this.props.status.isDraft) {
      throw new BusinessRuleError("Options are mutable only while the product is draft");
    }
    this.props.options = [...options];
  }

  /** No event — SEO metadata is internal config, not a downstream-relevant fact. */
  setSeo(seo: Seo | null): void {
    this.props.seo = seo;
  }

  /** No dedicated event — brand assignment is internal config (contrast `assignCategories`, which has one). */
  setBrand(brand: BrandRef | null): void {
    this.props.brand = brand;
  }

  assignCategories(categories: readonly CategoryRef[], eventId: string, occurredAt: Date): void {
    this.props.categories = [...categories];
    this.addDomainEvent(
      new ProductCategorized(
        { eventId, aggregateId: this.id, occurredAt },
        { sku: this.props.sku.value, categoryIds: categories.map((c) => c.categoryId) },
      ),
    );
  }

  attachMedia(media: MediaRef, eventId: string, occurredAt: Date): void {
    if (this.props.media.some((m) => m.assetId === media.assetId)) {
      throw new BusinessRuleError(`Media already attached: ${media.assetId}`);
    }
    this.props.media = [...this.props.media, media];
    this.addDomainEvent(
      new ProductMediaAttached(
        { eventId, aggregateId: this.id, occurredAt },
        { assetId: media.assetId },
      ),
    );
  }

  detachMedia(assetId: string, eventId: string, occurredAt: Date): void {
    if (!this.props.media.some((m) => m.assetId === assetId)) {
      throw new BusinessRuleError(`Media not attached: ${assetId}`);
    }
    this.props.media = this.props.media.filter((m) => m.assetId !== assetId);
    this.addDomainEvent(
      new ProductMediaDetached({ eventId, aggregateId: this.id, occurredAt }, { assetId }),
    );
  }

  /** `assetIds` must be an exact permutation of the currently attached media. */
  reorderMedia(assetIds: readonly string[], eventId: string, occurredAt: Date): void {
    const current = [...this.props.media.map((m) => m.assetId)].sort();
    const requested = [...assetIds].sort();
    if (current.length !== requested.length || !current.every((id, i) => id === requested[i])) {
      throw new BusinessRuleError("reorderMedia must be an exact permutation of attached media");
    }
    // The guard above already proved `assetIds` is an exact permutation of `this.props.media`'s
    // own asset ids, so every `find` here is guaranteed to succeed.
    this.props.media = assetIds.map((assetId) =>
      this.props.media.find((m) => m.assetId === assetId)!,
    );
    this.addDomainEvent(
      new ProductMediaReordered(
        { eventId, aggregateId: this.id, occurredAt },
        { assetIds: [...assetIds] },
      ),
    );
  }

  delete(eventId: string, occurredAt: Date): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Product is already deleted");
    }
    this.props.deleted = true;
    this.addDomainEvent(new ProductDeleted({ eventId, aggregateId: this.id, occurredAt }));
  }

  get sku(): Sku {
    return this.props.sku;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get status(): PublishState {
    return this.props.status;
  }

  get scheduledAt(): Date | null {
    return this.props.scheduledAt;
  }

  get brand(): BrandRef | null {
    return this.props.brand;
  }

  get categories(): readonly CategoryRef[] {
    return this.props.categories;
  }

  get options(): readonly ProductOption[] {
    return this.props.options;
  }

  get seo(): Seo | null {
    return this.props.seo;
  }

  get variants(): readonly Variant[] {
    return this.props.variants;
  }

  get media(): readonly MediaRef[] {
    return this.props.media;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }
}
