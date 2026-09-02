import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface SnapshotCreatedData {
  readonly period: string;
  readonly currency: string;
}

/** Raised when a {@link FinancialSnapshot} (period-end fact roll-up) is created. */
export class SnapshotCreated extends DomainEvent {
  readonly eventName = "finance.snapshot_created";
  readonly data: SnapshotCreatedData;

  constructor(props: DomainEventProps, data: SnapshotCreatedData) {
    super(props);
    this.data = data;
  }
}
