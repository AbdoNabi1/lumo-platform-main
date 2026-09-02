import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a collection is unpublished. */
export class CollectionUnpublished extends DomainEvent {
  readonly eventName = "collection.unpublished";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
