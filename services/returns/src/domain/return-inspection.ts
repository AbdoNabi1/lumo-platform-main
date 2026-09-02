import { Entity, type UniqueEntityId } from "@platform/domain";

interface ReturnInspectionProps {
  readonly itemRef: string;
  readonly passed: boolean;
  readonly note?: string;
  readonly occurredAt: Date;
}

/** One item's inspection result — idempotent by `itemRef` (recording a second inspection for the same item is a no-op at the application layer). */
export class ReturnInspection extends Entity<ReturnInspectionProps> {
  static create(
    id: UniqueEntityId,
    itemRef: string,
    passed: boolean,
    occurredAt: Date,
    note?: string,
  ): ReturnInspection {
    return new ReturnInspection({ itemRef, passed, note, occurredAt }, id);
  }

  get itemRef(): string {
    return this.props.itemRef;
  }

  get passed(): boolean {
    return this.props.passed;
  }

  get note(): string | undefined {
    return this.props.note;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
