import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { SeoChanged } from "./events/seo-changed.event";

interface SitemapProps {
  readonly name: string;
  urls: readonly string[];
  lastGeneratedAt?: Date;
}

/** A generated sitemap document — metadata only. */
export class Sitemap extends AggregateRoot<SitemapProps> {
  static create(id: UniqueEntityId, name: string, eventId: string, occurredAt: Date): Sitemap {
    const sitemap = new Sitemap({ name, urls: [] }, id);
    sitemap.raise("created", eventId, occurredAt);
    return sitemap;
  }

  static reconstitute(
    id: UniqueEntityId,
    name: string,
    urls: readonly string[],
    version: number,
    lastGeneratedAt?: Date,
  ): Sitemap {
    return new Sitemap({ name, urls, lastGeneratedAt }, id, version);
  }

  regenerate(urls: readonly string[], eventId: string, occurredAt: Date): void {
    this.props.urls = urls;
    this.props.lastGeneratedAt = occurredAt;
    this.raise("updated", eventId, occurredAt);
  }

  private raise(
    action: "created" | "updated" | "deleted",
    eventId: string,
    occurredAt: Date,
  ): void {
    this.addDomainEvent(
      new SeoChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          ref: this.props.name,
          entityType: "sitemap",
          action,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get urls(): readonly string[] {
    return this.props.urls;
  }

  get lastGeneratedAt(): Date | undefined {
    return this.props.lastGeneratedAt;
  }
}
