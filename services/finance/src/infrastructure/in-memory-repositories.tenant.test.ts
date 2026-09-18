import { describe, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Expense } from "../domain/expense";
import { FiscalPeriod } from "../domain/fiscal-period";
import {
  InMemoryExpenseRepository,
  InMemoryFiscalPeriodRepository,
} from "./in-memory-repositories";

let n = 0;
const nextId = () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;

function usd(minor: number): Money {
  const money = Money.create(minor, "USD");
  if (!money.ok) throw new Error("test setup: invalid money");
  return money.value;
}

describe("finance in-memory repositories write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("ExpenseRepository: the envelope carries the per-call tenantId", async () => {
    await assertWriteTimeTenant("finance/expense", async (outbox, tenantId) => {
      const repository = new InMemoryExpenseRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const expense = Expense.record(
        UniqueEntityId.from(nextId()),
        "cc-1",
        "cat-1",
        usd(1000),
        "Rent",
        new Date(0),
        nextId(),
        new Date(0),
      );
      await repository.save(expense, tenantId);
    });
  });

  it("FiscalPeriodRepository: the envelope carries the per-call tenantId when the period raises events", async () => {
    await assertWriteTimeTenant("finance/fiscal-period", async (outbox, tenantId) => {
      const repository = new InMemoryFiscalPeriodRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const period = FiscalPeriod.open(
        UniqueEntityId.from(nextId()),
        new Date(0),
        new Date(86_400_000),
      );
      period.close(nextId(), new Date(0));
      await repository.save(period, tenantId);
    });
  });
});
