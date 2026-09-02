import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface LedgerPostedData {
  readonly journalId: string;
  readonly sourceRef: string;
  readonly currency: string;
  readonly reversalOfJournalId?: string;
}

/** Raised when a {@link Journal} is posted (or a reversing journal is posted as a correction). */
export class LedgerPosted extends DomainEvent {
  readonly eventName = "finance.ledger_posted";
  readonly data: LedgerPostedData;

  constructor(props: DomainEventProps, data: LedgerPostedData) {
    super(props);
    this.data = data;
  }
}
