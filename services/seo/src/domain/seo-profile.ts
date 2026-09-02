import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { SeoChanged } from "./events/seo-changed.event";
import { type SeoMetadata } from "./value-objects/seo";

interface SeoProfileProps {
  readonly pageRef: string;
  metadata: SeoMetadata;
}

/** SEO metadata for one page — metadata only; never owns the page itself. */
export class SeoProfile extends AggregateRoot<SeoProfileProps> {
  static create(
    id: UniqueEntityId,
    pageRef: string,
    metadata: SeoMetadata,
    eventId: string,
    occurredAt: Date,
  ): SeoProfile {
    const profile = new SeoProfile({ pageRef, metadata }, id);
    profile.raise("created", eventId, occurredAt);
    return profile;
  }

  static reconstitute(
    id: UniqueEntityId,
    pageRef: string,
    metadata: SeoMetadata,
    version: number,
  ): SeoProfile {
    return new SeoProfile({ pageRef, metadata }, id, version);
  }

  update(metadata: SeoMetadata, eventId: string, occurredAt: Date): void {
    this.props.metadata = metadata;
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
          ref: this.props.pageRef,
          entityType: "profile",
          action,
        },
      ),
    );
  }

  get pageRef(): string {
    return this.props.pageRef;
  }

  get metadata(): SeoMetadata {
    return this.props.metadata;
  }
}
