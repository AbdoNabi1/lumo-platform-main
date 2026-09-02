import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a product is soft-deleted. */
export class ProductDeleted extends DomainEvent {
  readonly eventName = "product.deleted";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
