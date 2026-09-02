import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a collection is published. */
export class CollectionPublished extends DomainEvent {
  readonly eventName = "collection.published";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
