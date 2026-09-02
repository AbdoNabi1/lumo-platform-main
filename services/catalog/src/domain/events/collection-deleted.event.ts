import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a collection is deleted. */
export class CollectionDeleted extends DomainEvent {
  readonly eventName = "collection.deleted";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
