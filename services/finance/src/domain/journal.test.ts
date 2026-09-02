import { Money, UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { Journal } from "./journal";
import { JournalLine } from "./value-objects/journal-line";
import { LedgerDirection } from "./value-objects/ledger-direction";

function usd(amountMinor: number) {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw result.error;
  return result.value;
}

describe("Journal", () => {
  it("creates a balanced two-line journal", () => {
    const result = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(1000)),
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects an unbalanced journal", () => {
    const result = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(900)),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects a journal with fewer than 2 lines", () => {
    const result = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects a line whose currency does not match the journal's", () => {
    const eur = Money.create(1000, "EUR");
    if (!eur.ok) throw eur.error;
    const result = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), eur.value),
    ]);
    expect(result.ok).toBe(false);
  });

  it("posts once, raises LedgerPosted, and rejects a second post", () => {
    const created = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(1000)),
    ]);
    if (!created.ok) throw created.error;
    const journal = created.value;

    expect(journal.isPosted).toBe(false);
    journal.post("evt-1", new Date("2026-07-01T00:00:00Z"));
    expect(journal.isPosted).toBe(true);
    expect(journal.domainEvents).toHaveLength(1);
    expect(journal.domainEvents[0]?.eventName).toBe("finance.ledger_posted");
    expect(() => journal.post("evt-2", new Date())).toThrow();
  });

  it("toLedgerEntries throws before posting and returns entries after", () => {
    const created = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(500)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(500)),
    ]);
    if (!created.ok) throw created.error;
    const journal = created.value;
    expect(() => journal.toLedgerEntries()).toThrow();

    journal.post("evt-1", new Date());
    const entries = journal.toLedgerEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.amount.amountMinor).toBe(500);
  });

  it("reverse produces an already-posted, direction-flipped journal referencing the original", () => {
    const created = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(1000)),
    ]);
    if (!created.ok) throw created.error;
    const original = created.value;
    original.post("evt-1", new Date());

    const reversal = Journal.reverse(UniqueEntityId.from("j2"), original, "evt-2", new Date());
    expect(reversal.isPosted).toBe(true);
    expect(reversal.reversalOfJournalId?.toString()).toBe("j1");
    expect(reversal.lines[0]?.direction.value).toBe("credit");
    expect(reversal.lines[1]?.direction.value).toBe("debit");
  });

  it("cannot reverse a journal that was never posted", () => {
    const created = Journal.create(UniqueEntityId.from("j1"), "order:1", "USD", [
      JournalLine.create("1200-AR", LedgerDirection.debit(), usd(1000)),
      JournalLine.create("4000-REVENUE", LedgerDirection.credit(), usd(1000)),
    ]);
    if (!created.ok) throw created.error;
    expect(() =>
      Journal.reverse(UniqueEntityId.from("j2"), created.value, "evt-2", new Date()),
    ).toThrow();
  });
});
