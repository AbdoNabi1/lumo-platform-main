import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CollectionRenamedData {
  readonly name: string;
}

/** Raised when a collection's name is changed. */
export class CollectionRenamed extends DomainEvent {
  readonly eventName = "collection.renamed";
  readonly data: CollectionRenamedData;

  constructor(props: DomainEventProps, data: CollectionRenamedData) {
    super(props);
    this.data = data;
  }
}
