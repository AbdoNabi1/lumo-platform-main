import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface BrandUpdatedData {
  readonly name: string;
}

/** Raised when a brand's name is updated. */
export class BrandUpdated extends DomainEvent {
  readonly eventName = "brand.updated";
  readonly data: BrandUpdatedData;

  constructor(props: DomainEventProps, data: BrandUpdatedData) {
    super(props);
    this.data = data;
  }
}
