import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a brand is soft-deleted. */
export class BrandDeleted extends DomainEvent {
  readonly eventName = "brand.deleted";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
