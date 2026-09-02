import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { BrandCreated } from "./events/brand-created.event";
import { BrandDeleted } from "./events/brand-deleted.event";
import { BrandUpdated } from "./events/brand-updated.event";
import type { Slug } from "./value-objects/slug";

interface BrandProps {
  name: string;
  readonly slug: Slug;
  deleted: boolean;
}

/** Catalog brand aggregate (Commerce Sprint 1). */
export class Brand extends AggregateRoot<BrandProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    eventId: string,
    occurredAt: Date,
  ): Brand {
    const brand = new Brand({ name, slug, deleted: false }, id);
    brand.addDomainEvent(
      new BrandCreated({ eventId, aggregateId: brand.id, occurredAt }, { name, slug: slug.value }),
    );
    return brand;
  }

  /** Rebuilds a persisted brand — no events, persisted `version` carried (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    slug: Slug,
    deleted: boolean,
    version: number,
  ): Brand {
    return new Brand({ name, slug, deleted }, id, version);
  }

  update(name: string, eventId: string, occurredAt: Date): void {
    this.props.name = name;
    this.addDomainEvent(new BrandUpdated({ eventId, aggregateId: this.id, occurredAt }, { name }));
  }

  delete(eventId: string, occurredAt: Date): void {
    if (this.props.deleted) {
      throw new BusinessRuleError("Brand is already deleted");
    }
    this.props.deleted = true;
    this.addDomainEvent(new BrandDeleted({ eventId, aggregateId: this.id, occurredAt }));
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get deleted(): boolean {
    return this.props.deleted;
  }
}
