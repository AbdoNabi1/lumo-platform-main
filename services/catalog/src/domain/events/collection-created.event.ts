import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CollectionCreatedData {
  readonly name: string;
  readonly slug: string;
}

/** Raised when a collection is created. */
export class CollectionCreated extends DomainEvent {
  readonly eventName = "collection.created";
  readonly data: CollectionCreatedData;

  constructor(props: DomainEventProps, data: CollectionCreatedData) {
    super(props);
    this.data = data;
  }
}
