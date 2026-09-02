import { type Money, type UniqueEntityId, ValueObject } from "@platform/domain";
import type { LedgerDirection } from "./ledger-direction";

interface LedgerEntryProps {
  readonly journalId: UniqueEntityId;
  readonly sourceRef: string;
  readonly accountRef: string;
  readonly direction: LedgerDirection;
  readonly amount: Money;
  readonly memo?: string;
  readonly postedAt: Date;
}

/**
 * One immutable, append-only line of the ledger (ADR-0013 pattern) — the persisted projection of
 * a {@link JournalLine} once its parent {@link Journal} is posted. Never updated or deleted;
 * corrections are new reversing entries.
 */
export class LedgerEntry extends ValueObject<LedgerEntryProps> {
  static create(props: LedgerEntryProps): LedgerEntry {
    return new LedgerEntry(props);
  }

  get journalId(): UniqueEntityId {
    return this.props.journalId;
  }

  get sourceRef(): string {
    return this.props.sourceRef;
  }

  get accountRef(): string {
    return this.props.accountRef;
  }

  get direction(): LedgerDirection {
    return this.props.direction;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get memo(): string | undefined {
    return this.props.memo;
  }

  get postedAt(): Date {
    return this.props.postedAt;
  }
}
