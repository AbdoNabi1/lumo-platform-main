import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface BrandCreatedData {
  readonly name: string;
  readonly slug: string;
}

/** Raised when a brand is created. */
export class BrandCreated extends DomainEvent {
  readonly eventName = "brand.created";
  readonly data: BrandCreatedData;

  constructor(props: DomainEventProps, data: BrandCreatedData) {
    super(props);
    this.data = data;
  }
}
