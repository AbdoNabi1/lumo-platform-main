import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { CollectionCreated } from "./events/collection-created.event";
import { CollectionDeleted } from "./events/collection-deleted.event";
import { CollectionProductAdded } from "./events/collection-product-added.event";
import { CollectionProductRemoved } from "./events/collection-product-removed.event";
import { CollectionProductsReordered } from "./events/collection-products-reordered.event";
import { CollectionPublished } from "./events/collection-published.event";
import { CollectionRenamed } from "./events/collection-renamed.event";
import { CollectionUnpublished } from "./events/collection-unpublished.event";
import type { Slug } from "./value-objects/slug";

export type CollectionStatus = "draft" | "published";

interface CollectionProps {
  name: string;
  readonly slug: Slug;
  status: CollectionStatus;
  /** Ordered, manually curated (Sprint 7.0 §12: no rule-based/smart evaluation). */
  productIds: string[];
  deleted: boolean;
}

/** Manual, merchant-curated, ordered product grouping (Sprint 7.0 — the one genuine gap). */
export class Collection extends AggregateRoot<CollectionProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    eventId: string,
    occurredAt: Date,
  ): Collection {
    const collection = new Collection(
      { name, slug, status: "draft", productIds: [], deleted: false },
      id,
    );
    collection.addDomainEvent(
      new CollectionCreated(
        { eventId, aggregateId: collection.id, occurredAt },
        { name, slug: slug.value },
      ),
    );
    return collection;
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    status: CollectionStatus,
    productIds: readonly string[],
    deleted: boolean,
    version: number,
  ): Collection {
    return new Collection(
      { name, slug, status, productIds: [...productIds], deleted },
      id,
      version,
    );
  }

  rename(name: string, eventId: string, occurredAt: Date): void {
    this.props.name = name;
    this.addDomainEvent(
      new CollectionRenamed({ eventId, aggregateId: this.id, occurredAt }, { name }),
    );
  }

  addProduct(productId: string, eventId: string, occurredAt: Date): void {
    if (this.props.productIds.includes(productId)) {
      throw new BusinessRuleError(`Product already in collection: ${productId}`);
    }
    this.props.productIds.push(productId);
    this.addDomainEvent(
      new CollectionProductAdded({ eventId, aggregateId: this.id, occurredAt }, { productId }),
    );
  }

  removeProduct(productId: string, eventId: string, occurredAt: Date): void {
    const index = this.props.productIds.indexOf(productId);
    if (index === -1) {
      throw new BusinessRuleError(`Product not in collection: ${productId}`);
    }
    this.props.productIds.splice(index, 1);
    this.addDomainEvent(
      new CollectionProductRemoved({ eventId, aggregateId: this.id, occurredAt }, { productId }),
    );
  }

  /** `productIds` must be an exact permutation of the collection's current products. */
  reorderProducts(productIds: readonly string[], eventId: string, occurredAt: Date): void {
    const current = [...this.props.productIds].sort();
    const requested = [...productIds].sort();
    if (current.length !== requested.length || !current.every((id, i) => id === requested[i])) {
      throw new BusinessRuleError(
        "reorderProducts must be an exact permutation of the collection's products",
      );
    }
    this.props.productIds = [...productIds];
    this.addDomainEvent(
      new CollectionProductsReordered(
        { eventId, aggregateId: this.id, occurredAt },
        { productIds: [...productIds] },
      ),
    );
  }

  publish(eventId: string, occurredAt: Date): void {
    if (this.props.status === "published") {
      throw new BusinessRuleError("Collection is already published");
    }
    this.props.status = "published";
    this.addDomainEvent(new CollectionPublished({ eventId, aggregateId: this.id, occurredAt }));
  }

  unpublish(eventId: string, occurredAt: Date): void {
    if (this.props.status !== "published") {
      throw new BusinessRuleError("Only a published collection can be unpublished");
    }
    this.props.status = "draft";
    this.addDomainEvent(new CollectionUnpublished({ eventId, aggregateId: this.id, occurredAt }));
  }

  delete(eventId: string, occurredAt: Date): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Collection is already deleted");
    }
    this.props.deleted = true;
    this.addDomainEvent(new CollectionDeleted({ eventId, aggregateId: this.id, occurredAt }));
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get status(): CollectionStatus {
    return this.props.status;
  }

  get productIds(): readonly string[] {
    return this.props.productIds;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }
}
