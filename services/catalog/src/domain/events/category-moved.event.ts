import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CategoryMovedData {
  readonly newParentId: string | null;
}

/** Raised when a category is reparented. */
export class CategoryMoved extends DomainEvent {
  readonly eventName = "category.moved";
  readonly data: CategoryMovedData;

  constructor(props: DomainEventProps, data: CategoryMovedData) {
    super(props);
    this.data = data;
  }
}
