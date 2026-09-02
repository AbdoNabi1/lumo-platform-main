import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { CategoryCreated } from "./events/category-created.event";
import { CategoryDeleted } from "./events/category-deleted.event";
import { CategoryMoved } from "./events/category-moved.event";
import type { Slug } from "./value-objects/slug";

interface CategoryProps {
  name: string;
  slug: Slug;
  parentId: string | null;
  deleted: boolean;
}

/** Catalog category aggregate — hierarchical (Commerce Sprint 1 added `parent`/`moveTo`). */
export class Category extends AggregateRoot<CategoryProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    parentId: string | null,
    eventId: string,
    occurredAt: Date,
  ): Category {
    const category = new Category({ name, slug, parentId, deleted: false }, id);
    category.addDomainEvent(
      new CategoryCreated(
        { eventId, aggregateId: category.id, occurredAt },
        { name, slug: slug.value, parentId },
      ),
    );
    return category;
  }

  /** Rebuilds a persisted category - no events, persisted `version` carried (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    parentId: string | null,
    deleted: boolean,
    version: number,
  ): Category {
    return new Category({ name, slug, parentId, deleted }, id, version);
  }

  /** Reparents this category. `ancestorIds` (the full chain being moved under) must not contain this id. */
  moveTo(
    newParentId: string | null,
    ancestorIds: readonly string[],
    eventId: string,
    occurredAt: Date,
  ): void {
    if (newParentId === this.id.toString() || ancestorIds.includes(this.id.toString())) {
      throw new BusinessRuleError("A category cannot become its own ancestor");
    }
    this.props.parentId = newParentId;
    this.addDomainEvent(
      new CategoryMoved({ eventId, aggregateId: this.id, occurredAt }, { newParentId }),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get parentId(): string | null {
    return this.props.parentId;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }

  delete(eventId: string, occurredAt: Date): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Category is already deleted");
    }
    this.props.deleted = true;
    this.addDomainEvent(new CategoryDeleted({ eventId, aggregateId: this.id, occurredAt }));
  }
}
