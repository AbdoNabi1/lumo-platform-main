import {
  AggregateRoot,
  BusinessRuleError,
  type UniqueEntityId,
  ValidationError,
} from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { LedgerPosted } from "./events/ledger-posted.event";
import { JournalLine } from "./value-objects/journal-line";
import { LedgerEntry } from "./value-objects/ledger-entry";

interface JournalProps {
  readonly sourceRef: string;
  readonly currency: string;
  readonly lines: readonly JournalLine[];
  readonly reversalOfJournalId: UniqueEntityId | null;
  postedAt: Date | null;
}

/**
 * A balanced double-entry journal (ADR-0024/D-075) — the unit of posting to the immutable
 * ledger. Every posted journal has ≥2 lines, exactly one currency, and debits = credits;
 * `LedgerPoster` (M2) builds journals from commerce-event templates, and `post` is the single
 * point where a balanced journal becomes {@link LedgerEntry} facts. Corrections are new,
 * separately-posted reversing journals (`reverse`) — a posted journal is never mutated.
 */
export class Journal extends AggregateRoot<JournalProps> {
  static create(
    id: UniqueEntityId,
    sourceRef: string,
    currency: string,
    lines: readonly JournalLine[],
  ): Result<Journal, ValidationError | BusinessRuleError> {
    if (lines.length < 2) {
      return err(
        new ValidationError("Invalid journal", [
          { field: "lines", message: "a journal must have at least 2 lines" },
        ]),
      );
    }
    for (const line of lines) {
      if (line.amount.currency !== currency) {
        return err(new BusinessRuleError("All journal lines must share the journal's currency"));
      }
    }
    const debits = sumByDirection(lines, "debit");
    const credits = sumByDirection(lines, "credit");
    if (debits !== credits) {
      return err(
        new BusinessRuleError(
          `Journal is not balanced: debits (${debits}) != credits (${credits})`,
        ),
      );
    }
    return ok(
      new Journal(
        { sourceRef, currency, lines: [...lines], reversalOfJournalId: null, postedAt: null },
        id,
      ),
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    sourceRef: string,
    currency: string,
    lines: readonly JournalLine[],
    reversalOfJournalId: UniqueEntityId | null,
    postedAt: Date | null,
    version: number,
  ): Journal {
    return new Journal(
      { sourceRef, currency, lines: [...lines], reversalOfJournalId, postedAt },
      id,
      version,
    );
  }

  /** Builds a new, already-posted reversing journal for `original` (flipped directions). */
  static reverse(
    newId: UniqueEntityId,
    original: Journal,
    eventId: string,
    occurredAt: Date,
  ): Journal {
    if (!original.isPosted) {
      throw new BusinessRuleError("Cannot reverse a journal that was never posted");
    }
    const flipped = original.props.lines.map((line) =>
      JournalLine.create(line.accountRef, line.direction.opposite, line.amount, line.memo),
    );
    const reversal = new Journal(
      {
        sourceRef: original.props.sourceRef,
        currency: original.props.currency,
        lines: flipped,
        reversalOfJournalId: original.id,
        postedAt: null,
      },
      newId,
    );
    reversal.post(eventId, occurredAt);
    return reversal;
  }

  post(eventId: string, occurredAt: Date): void {
    if (this.props.postedAt !== null) {
      throw new BusinessRuleError("Journal is already posted");
    }
    this.props.postedAt = occurredAt;
    this.addDomainEvent(
      new LedgerPosted(
        { eventId, aggregateId: this.id, occurredAt },
        {
          journalId: this.id.toString(),
          sourceRef: this.props.sourceRef,
          currency: this.props.currency,
          reversalOfJournalId: this.props.reversalOfJournalId?.toString(),
        },
      ),
    );
  }

  /** Projects this posted journal's lines into immutable {@link LedgerEntry} facts. */
  toLedgerEntries(): readonly LedgerEntry[] {
    if (this.props.postedAt === null) {
      throw new BusinessRuleError("Cannot derive ledger entries from an unposted journal");
    }
    const postedAt = this.props.postedAt;
    return this.props.lines.map((line) =>
      LedgerEntry.create({
        journalId: this.id,
        sourceRef: this.props.sourceRef,
        accountRef: line.accountRef,
        direction: line.direction,
        amount: line.amount,
        memo: line.memo,
        postedAt,
      }),
    );
  }

  get sourceRef(): string {
    return this.props.sourceRef;
  }

  get currency(): string {
    return this.props.currency;
  }

  get lines(): readonly JournalLine[] {
    return this.props.lines;
  }

  get isPosted(): boolean {
    return this.props.postedAt !== null;
  }

  get postedAt(): Date | null {
    return this.props.postedAt;
  }

  get reversalOfJournalId(): UniqueEntityId | null {
    return this.props.reversalOfJournalId;
  }
}

function sumByDirection(lines: readonly JournalLine[], direction: "debit" | "credit"): number {
  return lines
    .filter((line) => line.direction.value === direction)
    .reduce((sum, line) => sum + line.amount.amountMinor, 0);
}
