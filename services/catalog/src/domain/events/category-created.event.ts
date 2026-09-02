import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CategoryCreatedData {
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

/** Raised when a category is created. */
export class CategoryCreated extends DomainEvent {
  readonly eventName = "category.created";
  readonly data: CategoryCreatedData;

  constructor(props: DomainEventProps, data: CategoryCreatedData) {
    super(props);
    this.data = data;
  }
}
