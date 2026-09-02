import { Money } from "@platform/domain";
import { describe, expect, it } from "vitest";
import { Account } from "../account";
import { AccountType } from "../value-objects/account-type";
import { Balance } from "../value-objects/balance";
import { LedgerDirection } from "../value-objects/ledger-direction";
import { LedgerEntry } from "../value-objects/ledger-entry";
import { UniqueEntityId } from "@platform/domain";
import { LedgerService } from "./ledger-service";
import { StatementBuilder } from "./statement-builder";

function usd(amountMinor: number) {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw result.error;
  return result.value;
}

function entry(accountRef: string, direction: "debit" | "credit", amountMinor: number) {
  return LedgerEntry.create({
    journalId: UniqueEntityId.from("j1"),
    sourceRef: "order:1",
    accountRef,
    direction: LedgerDirection.from(direction),
    amount: usd(amountMinor),
    postedAt: new Date("2026-07-01T00:00:00Z"),
  });
}

describe("LedgerService.trialBalance", () => {
  it("sums debits and credits per account", () => {
    const entries = [
      entry("1200-AR", "debit", 1000),
      entry("4000-REVENUE", "credit", 1000),
      entry("5000-COGS", "debit", 400),
      entry("1300-INVENTORY", "credit", 400),
    ];
    const rows = LedgerService.trialBalance(entries);
    const ar = rows.find((r) => r.accountRef === "1200-AR");
    expect(ar?.debitMinor).toBe(1000);
    expect(ar?.creditMinor).toBe(0);
  });
});

describe("StatementBuilder", () => {
  it("computes an income statement and satisfies the balance sheet identity", () => {
    const accounts = [
      Account.create(
        UniqueEntityId.from("a1"),
        "1200-AR",
        "Accounts Receivable",
        AccountType.asset(),
      ),
      Account.create(UniqueEntityId.from("a2"), "4000-REVENUE", "Revenue", AccountType.revenue()),
      Account.create(UniqueEntityId.from("a3"), "5000-COGS", "COGS", AccountType.expense()),
      Account.create(UniqueEntityId.from("a4"), "1300-INVENTORY", "Inventory", AccountType.asset()),
    ].map((r) => {
      if (!r.ok) throw r.error;
      return r.value;
    });

    const entries = [
      entry("1200-AR", "debit", 1000),
      entry("4000-REVENUE", "credit", 1000),
      entry("5000-COGS", "debit", 400),
      entry("1300-INVENTORY", "credit", 400),
    ];

    const income = StatementBuilder.incomeStatement(entries, accounts, "USD");
    expect(income.revenue.amountMinor).toBe(1000);
    expect(income.cogs.amountMinor).toBe(400);
    expect(income.netIncome.amountMinor).toBe(600);

    // assets = liabilities + equity + net income: (1000 - 400) = 0 + 0 + 600.
    const sheet = StatementBuilder.balanceSheet(entries, accounts, income.netIncome, "USD");
    expect(sheet.assets.amountMinor).toBe(600);
    expect(sheet.liabilities.amountMinor).toBe(0);
    expect(sheet.equity.amountMinor).toBe(0);
  });

  it("throws when the accounting identity does not hold", () => {
    const asset = Account.create(UniqueEntityId.from("a1"), "1200-AR", "AR", AccountType.asset());
    if (!asset.ok) throw asset.error;
    const entries = [entry("1200-AR", "debit", 1000)];
    expect(() =>
      StatementBuilder.balanceSheet(entries, [asset.value], Balance.zero("USD"), "USD"),
    ).toThrow();
  });
});
