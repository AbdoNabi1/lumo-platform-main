import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Raised when a category is soft-deleted (rejected while it has live children). */
export class CategoryDeleted extends DomainEvent {
  readonly eventName = "category.deleted";
  readonly data: Record<string, never> = {};

  constructor(props: DomainEventProps) {
    super(props);
  }
}
