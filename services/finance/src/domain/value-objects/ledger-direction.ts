import { ValueObject } from "@platform/domain";

export type LedgerDirectionValue = "debit" | "credit";

/** Which side of a double-entry line a {@link JournalLine}/{@link LedgerEntry} posts to. */
export class LedgerDirection extends ValueObject<{ readonly value: LedgerDirectionValue }> {
  static debit(): LedgerDirection {
    return new LedgerDirection({ value: "debit" });
  }

  static credit(): LedgerDirection {
    return new LedgerDirection({ value: "credit" });
  }

  static from(value: LedgerDirectionValue): LedgerDirection {
    return new LedgerDirection({ value });
  }

  get value(): LedgerDirectionValue {
    return this.props.value;
  }

  get isDebit(): boolean {
    return this.props.value === "debit";
  }

  get opposite(): LedgerDirection {
    return this.props.value === "debit" ? LedgerDirection.credit() : LedgerDirection.debit();
  }
}
