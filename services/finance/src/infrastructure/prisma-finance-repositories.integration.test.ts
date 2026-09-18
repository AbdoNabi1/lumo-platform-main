import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Account } from "../domain/account";
import { Budget } from "../domain/budget";
import { CogsSnapshot } from "../domain/cogs-snapshot";
import { CostCenter } from "../domain/cost-center";
import { ExchangeRate } from "../domain/exchange-rate";
import { Expense } from "../domain/expense";
import { ExpenseCategory } from "../domain/expense-category";
import { FiscalPeriod } from "../domain/fiscal-period";
import { Journal } from "../domain/journal";
import { TaxProfile } from "../domain/tax-profile";
import { AccountType } from "../domain/value-objects/account-type";
import { CostComponent } from "../domain/value-objects/cost-component";
import { LedgerDirection } from "../domain/value-objects/ledger-direction";
import { JournalLine } from "../domain/value-objects/journal-line";
import { TaxRate } from "../domain/value-objects/tax-rate";
import { FinanceEventTranslator } from "./finance-event-translator";
import {
  PrismaAccountRepository,
  PrismaBudgetRepository,
  PrismaCogsSnapshotRepository,
  PrismaCostCenterRepository,
  PrismaExchangeRateRepository,
  PrismaExpenseCategoryRepository,
  PrismaExpenseRepository,
  PrismaFiscalPeriodRepository,
  PrismaJournalRepository,
  PrismaTaxProfileRepository,
} from "./prisma-finance-repositories";

/**
 * Phase A.25 Task 9 — real-PostgreSQL integration coverage for Finance (previously none).
 * Follows the established reference pattern (see PrismaOrderRepository's integration suite):
 * gated on `DATABASE_URL_TEST`, skipped (never faked) without it.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/finance test
 *
 * ADR-0014 (WP-10 T10.3): repositories are built once, as tenant-agnostic singletons — every
 * `tenantId` below is a per-call argument, following `PrismaWishlistRepository`'s own integration
 * suite's reference shape (a SINGLE repository instance, called under two different tenants,
 * asserting neither's data leaks into the other's result). Not executed this session — no
 * `DATABASE_URL_TEST` / live Postgres available here — updated only so it compiles and stays
 * correctly gated; `describe.runIf` still skips it without a real database.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO/aggregate");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("Prisma Finance repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const tenantId = `tenant-a25-finance-${crypto.randomUUID().slice(0, 8)}`;
  const otherTenantId = `tenant-a25-finance-other-${crypto.randomUUID().slice(0, 8)}`;

  function wire() {
    const prisma = createTestPrismaClient(databaseUrl);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new FinanceEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "finance",
    });
    const context = rootEventContext(ids);
    const outboxDeps = { prisma, outbox, context };
    return {
      prisma,
      accounts: new PrismaAccountRepository({ prisma }),
      costCenters: new PrismaCostCenterRepository({ prisma }),
      expenseCategories: new PrismaExpenseCategoryRepository({ prisma }),
      expenses: new PrismaExpenseRepository(outboxDeps),
      budgets: new PrismaBudgetRepository(outboxDeps),
      exchangeRates: new PrismaExchangeRateRepository({ prisma }),
      fiscalPeriods: new PrismaFiscalPeriodRepository(outboxDeps),
      taxProfiles: new PrismaTaxProfileRepository({ prisma }),
      cogsSnapshots: new PrismaCogsSnapshotRepository({ prisma }),
      journals: new PrismaJournalRepository(outboxDeps),
      unitOfWork: new PrismaUnitOfWork(prisma),
      outboxStore,
    };
  }

  function newAccount(code: string): Account {
    return unwrap(
      Account.create(UniqueEntityId.from(ids.generate()), code, "Cash", AccountType.asset()),
    );
  }

  function balancedJournal(
    sourceRef: string,
    debitAccount: string,
    creditAccount: string,
  ): Journal {
    const amount = unwrap(Money.create(5000, "USD"));
    const lines = [
      JournalLine.create(debitAccount, LedgerDirection.debit(), amount),
      JournalLine.create(creditAccount, LedgerDirection.credit(), amount),
    ];
    return unwrap(Journal.create(UniqueEntityId.from(ids.generate()), sourceRef, "USD", lines));
  }

  // --- CRUD -----------------------------------------------------------------------------------

  it("creates and reads an Account back exactly (create)", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);

    await accounts.save(account, tenantId);
    const loaded = await accounts.findById(account.id.toString(), tenantId);

    expect(loaded).not.toBeNull();
    expect(loaded?.code).toBe(account.code);
    expect(loaded?.name).toBe("Cash");
    expect(loaded?.active).toBe(true);
    await prisma.$disconnect();
  });

  it("updates an existing Account (update)", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account, tenantId);

    const loaded = await accounts.findById(account.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.rename("Petty Cash");
    await accounts.save(loaded, tenantId);

    const reloaded = await accounts.findById(account.id.toString(), tenantId);
    expect(reloaded?.name).toBe("Petty Cash");
    expect(reloaded?.version).toBe(2);
    await prisma.$disconnect();
  });

  // --- Constraints ------------------------------------------------------------------------------

  it("enforces the unique (tenantId, code) constraint (constraints)", async () => {
    const { prisma, accounts } = wire();
    const code = `A25-DUP-${ids.generate()}`;
    await accounts.save(newAccount(code), tenantId);

    await expect(accounts.save(newAccount(code), tenantId)).rejects.toThrow();
    await prisma.$disconnect();
  });

  // --- Transaction commit / rollback ------------------------------------------------------------

  it("commits the Journal + its LedgerEntry lines + outbox row atomically (transaction commit)", async () => {
    const { prisma, journals, unitOfWork, outboxStore } = wire();
    const debit = `acct-debit-${ids.generate()}`;
    const credit = `acct-credit-${ids.generate()}`;
    const journal = balancedJournal(`src-${ids.generate()}`, debit, credit);
    journal.post(ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => journals.append(journal, tenantId, tx));

    const loaded = await journals.findById(journal.id.toString(), tenantId);
    expect(loaded).not.toBeNull();
    expect(loaded?.lines).toHaveLength(2);
    expect(loaded?.isPosted).toBe(true);

    const ledgerLines = await journals.findByAccount(debit, tenantId);
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]?.amount.amountMinor).toBe(5000);

    // `lumo_test`'s `platform.outbox` accumulates unconsumed pending rows across every phase's
    // test runs (no relay/consumer drains it here) — fetchPending(100) alone would miss a fresh
    // row behind hundreds of older ones, so assert directly on the row this test wrote.
    const pending = await outboxStore.fetchPending(10_000);
    expect(pending.some((e) => e.key === journal.id.toString())).toBe(true);
    await prisma.$disconnect();
  });

  it("rolls back the whole unit of work when a later step in the same transaction throws (transaction rollback / failure atomicity)", async () => {
    const { prisma, journals, unitOfWork } = wire();
    const debit = `acct-debit-${ids.generate()}`;
    const credit = `acct-credit-${ids.generate()}`;
    const journal = balancedJournal(`src-${ids.generate()}`, debit, credit);
    journal.post(ids.generate(), clock.now());

    await expect(
      unitOfWork.run(async (tx) => {
        await journals.append(journal, tenantId, tx);
        throw new Error("simulated downstream failure after the journal write");
      }),
    ).rejects.toThrow("simulated downstream failure");

    // Nothing from the aborted transaction should be visible: neither the journal row, its
    // ledger lines, nor the outbox row (same-transaction outbox is the whole point of ADR-0003).
    const loaded = await journals.findById(journal.id.toString(), tenantId);
    expect(loaded).toBeNull();
    const ledgerLines = await journals.findByAccount(debit, tenantId);
    expect(ledgerLines).toHaveLength(0);
    await prisma.$disconnect();
  });

  // --- Concurrent update / stale-write (optimistic concurrency) ---------------------------------

  it("detects a concurrent update via ConcurrencyError rather than silently overwriting (concurrent update / stale write)", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account, tenantId);

    const copyA = await accounts.findById(account.id.toString(), tenantId);
    const copyB = await accounts.findById(account.id.toString(), tenantId);
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.rename("Renamed by A");
    copyB.rename("Renamed by B");

    await accounts.save(copyA, tenantId);
    await expect(accounts.save(copyB, tenantId)).rejects.toBeInstanceOf(ConcurrencyError);

    const finalState = await accounts.findById(account.id.toString(), tenantId);
    expect(finalState?.name).toBe("Renamed by A"); // B's stale write never applied
    await prisma.$disconnect();
  });

  it("rejects true concurrent writes to the same Account under real simultaneous transactions", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account, tenantId);

    const copyA = await accounts.findById(account.id.toString(), tenantId);
    const copyB = await accounts.findById(account.id.toString(), tenantId);
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.rename("Concurrent A");
    copyB.rename("Concurrent B");

    const results = await Promise.allSettled([
      accounts.save(copyA, tenantId),
      accounts.save(copyB, tenantId),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await prisma.$disconnect();
  });

  // --- Idempotency ------------------------------------------------------------------------------

  it("is idempotent when the same LedgerEntry rows are written twice (skipDuplicates)", async () => {
    const { prisma, journals, unitOfWork } = wire();
    const debit = `acct-debit-${ids.generate()}`;
    const credit = `acct-credit-${ids.generate()}`;
    const journal = balancedJournal(`src-${ids.generate()}`, debit, credit);
    journal.post(ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => journals.append(journal, tenantId, tx));

    // Re-append the identical journal id: create() will fail on the PK, proving the journal
    // itself cannot be duplicated — the important idempotency guarantee for an append-only ledger.
    await expect(
      unitOfWork.run(async (tx) => journals.append(journal, tenantId, tx)),
    ).rejects.toThrow();

    const ledgerLines = await journals.findByAccount(debit, tenantId);
    expect(ledgerLines).toHaveLength(1); // no duplicate ledger fact from the failed re-append
    await prisma.$disconnect();
  });

  // --- Tenant isolation (ADR-0014, WP-10 T10.5) --------------------------------------------------
  //
  // One test per repository: through a SINGLE repository instance, write under tenant A and
  // tenant B, read each back, and assert no crossover in either direction.

  it("PrismaAccountRepository: does not leak Account rows across tenants", async () => {
    const { prisma, accounts } = wire();
    const code = `A25-ISO-${ids.generate()}`;
    const accountA = newAccount(code);
    const accountB = newAccount(code);
    await accounts.save(accountA, tenantId);
    await accounts.save(accountB, otherTenantId);

    expect((await accounts.findById(accountA.id.toString(), tenantId))?.id.toString()).toBe(
      accountA.id.toString(),
    );
    expect(await accounts.findById(accountA.id.toString(), otherTenantId)).toBeNull();
    expect((await accounts.findByCode(code, tenantId))?.id.toString()).toBe(accountA.id.toString());
    expect((await accounts.findByCode(code, otherTenantId))?.id.toString()).toBe(
      accountB.id.toString(),
    );
    const listA = await accounts.list(tenantId);
    expect(listA.some((a) => a.id.toString() === accountB.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaCostCenterRepository: does not leak CostCenter rows across tenants", async () => {
    const { prisma, costCenters } = wire();
    const code = `A25-ISO-${ids.generate()}`;
    const a = unwrap(CostCenter.create(UniqueEntityId.from(ids.generate()), code, "Ops A"));
    const b = unwrap(CostCenter.create(UniqueEntityId.from(ids.generate()), code, "Ops B"));
    await costCenters.save(a, tenantId);
    await costCenters.save(b, otherTenantId);

    expect(await costCenters.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await costCenters.findById(b.id.toString(), tenantId)).toBeNull();
    const listA = await costCenters.list(tenantId);
    expect(listA.some((c) => c.id.toString() === b.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaExpenseCategoryRepository: does not leak ExpenseCategory rows across tenants", async () => {
    const { prisma, expenseCategories } = wire();
    const a = unwrap(ExpenseCategory.create(UniqueEntityId.from(ids.generate()), "Travel A", null));
    const b = unwrap(ExpenseCategory.create(UniqueEntityId.from(ids.generate()), "Travel B", null));
    await expenseCategories.save(a, tenantId);
    await expenseCategories.save(b, otherTenantId);

    expect(await expenseCategories.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await expenseCategories.findById(b.id.toString(), tenantId)).toBeNull();
    const listA = await expenseCategories.list(tenantId);
    expect(listA.some((c) => c.id.toString() === b.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaExpenseRepository: does not leak Expense rows across tenants", async () => {
    const { prisma, expenses, unitOfWork } = wire();
    const incurredAt = new Date("2026-08-01T00:00:00.000Z");
    const a = Expense.record(
      UniqueEntityId.from(ids.generate()),
      "cc-a",
      "cat-a",
      unwrap(Money.create(1000, "USD")),
      "Isolation A",
      incurredAt,
      ids.generate(),
      clock.now(),
    );
    const b = Expense.record(
      UniqueEntityId.from(ids.generate()),
      "cc-b",
      "cat-b",
      unwrap(Money.create(2000, "USD")),
      "Isolation B",
      incurredAt,
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => expenses.save(a, tenantId, tx));
    await unitOfWork.run((tx) => expenses.save(b, otherTenantId, tx));

    expect(await expenses.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await expenses.findById(b.id.toString(), tenantId)).toBeNull();
    const rangeStart = new Date("2026-07-01T00:00:00.000Z");
    const rangeEnd = new Date("2026-09-01T00:00:00.000Z");
    const listA = await expenses.findByPeriod(rangeStart, rangeEnd, tenantId);
    expect(listA.some((e) => e.id.toString() === b.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaBudgetRepository: does not leak Budget rows across tenants", async () => {
    const { prisma, budgets, unitOfWork } = wire();
    const period = "2026-08";
    const costCenterRef = `cc-iso-${ids.generate()}`;
    const a = Budget.create(
      UniqueEntityId.from(ids.generate()),
      costCenterRef,
      period,
      unwrap(Money.create(10_000, "USD")),
      ids.generate(),
      clock.now(),
    );
    const b = Budget.create(
      UniqueEntityId.from(ids.generate()),
      costCenterRef,
      period,
      unwrap(Money.create(20_000, "USD")),
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => budgets.save(a, tenantId, tx));
    await unitOfWork.run((tx) => budgets.save(b, otherTenantId, tx));

    expect(await budgets.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await budgets.findById(b.id.toString(), tenantId)).toBeNull();
    expect(
      (await budgets.findByCostCenterAndPeriod(costCenterRef, period, tenantId))?.id.toString(),
    ).toBe(a.id.toString());
    expect(
      (
        await budgets.findByCostCenterAndPeriod(costCenterRef, period, otherTenantId)
      )?.id.toString(),
    ).toBe(b.id.toString());
    await prisma.$disconnect();
  });

  it("PrismaExchangeRateRepository: does not leak ExchangeRate rows across tenants", async () => {
    const { prisma, exchangeRates } = wire();
    const at = new Date("2026-08-01T00:00:00.000Z");
    const a = ExchangeRate.record(UniqueEntityId.from(ids.generate()), "USD", "EUR", 0.9, at);
    const b = ExchangeRate.record(UniqueEntityId.from(ids.generate()), "USD", "EUR", 0.5, at);
    await exchangeRates.add(a, tenantId);
    await exchangeRates.add(b, otherTenantId);

    expect((await exchangeRates.findEffective("USD", "EUR", at, tenantId))?.rate).toBe(0.9);
    expect((await exchangeRates.findEffective("USD", "EUR", at, otherTenantId))?.rate).toBe(0.5);
    const listA = await exchangeRates.list("USD", "EUR", tenantId);
    expect(listA.some((r) => r.id.toString() === b.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaFiscalPeriodRepository: does not leak FiscalPeriod rows across tenants", async () => {
    const { prisma, fiscalPeriods, unitOfWork } = wire();
    const start = new Date("2026-08-01T00:00:00.000Z");
    const end = new Date("2026-08-31T23:59:59.000Z");
    const at = new Date("2026-08-15T00:00:00.000Z");
    const a = FiscalPeriod.open(UniqueEntityId.from(ids.generate()), start, end);
    const b = FiscalPeriod.open(UniqueEntityId.from(ids.generate()), start, end);
    await unitOfWork.run((tx) => fiscalPeriods.save(a, tenantId, tx));
    await unitOfWork.run((tx) => fiscalPeriods.save(b, otherTenantId, tx));

    expect(await fiscalPeriods.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await fiscalPeriods.findById(b.id.toString(), tenantId)).toBeNull();
    expect((await fiscalPeriods.findCurrent(at, tenantId))?.id.toString()).toBe(a.id.toString());
    expect((await fiscalPeriods.findCurrent(at, otherTenantId))?.id.toString()).toBe(
      b.id.toString(),
    );
    await prisma.$disconnect();
  });

  it("PrismaTaxProfileRepository: does not leak TaxProfile rows across tenants", async () => {
    const { prisma, taxProfiles } = wire();
    const jurisdiction = `US-ISO-${ids.generate()}`;
    const a = unwrap(
      TaxProfile.define(UniqueEntityId.from(ids.generate()), jurisdiction, [
        unwrap(TaxRate.create(500)),
      ]),
    );
    const b = unwrap(
      TaxProfile.define(UniqueEntityId.from(ids.generate()), jurisdiction, [
        unwrap(TaxRate.create(700)),
      ]),
    );
    await taxProfiles.save(a, tenantId);
    await taxProfiles.save(b, otherTenantId);

    expect(await taxProfiles.findById(a.id.toString(), otherTenantId)).toBeNull();
    expect(await taxProfiles.findById(b.id.toString(), tenantId)).toBeNull();
    expect((await taxProfiles.findByJurisdiction(jurisdiction, tenantId))?.id.toString()).toBe(
      a.id.toString(),
    );
    expect((await taxProfiles.findByJurisdiction(jurisdiction, otherTenantId))?.id.toString()).toBe(
      b.id.toString(),
    );
    await prisma.$disconnect();
  });

  it("PrismaCogsSnapshotRepository: does not leak CogsSnapshot rows across tenants", async () => {
    const { prisma, cogsSnapshots } = wire();
    const productRef = `prod-iso-${ids.generate()}`;
    const at = new Date("2026-08-01T00:00:00.000Z");
    const a = CogsSnapshot.record(
      UniqueEntityId.from(ids.generate()),
      productRef,
      [CostComponent.create("unit_cost", unwrap(Money.create(100, "USD")))],
      at,
    );
    const b = CogsSnapshot.record(
      UniqueEntityId.from(ids.generate()),
      productRef,
      [CostComponent.create("unit_cost", unwrap(Money.create(999, "USD")))],
      at,
    );
    await cogsSnapshots.add(a, tenantId);
    await cogsSnapshots.add(b, otherTenantId);

    expect(
      (await cogsSnapshots.findEffective(productRef, at, tenantId))?.components[0]?.amount
        .amountMinor,
    ).toBe(100);
    expect(
      (await cogsSnapshots.findEffective(productRef, at, otherTenantId))?.components[0]?.amount
        .amountMinor,
    ).toBe(999);
    const listA = await cogsSnapshots.list(productRef, tenantId);
    expect(listA.some((s) => s.id.toString() === b.id.toString())).toBe(false);
    await prisma.$disconnect();
  });

  it("PrismaJournalRepository: does not leak Journal/LedgerEntry rows across tenants", async () => {
    const { prisma, journals, unitOfWork } = wire();
    const sourceRef = `src-iso-${ids.generate()}`;
    const debitA = `acct-debit-a-${ids.generate()}`;
    const creditA = `acct-credit-a-${ids.generate()}`;
    const debitB = `acct-debit-b-${ids.generate()}`;
    const creditB = `acct-credit-b-${ids.generate()}`;
    const journalA = balancedJournal(sourceRef, debitA, creditA);
    const journalB = balancedJournal(sourceRef, debitB, creditB);
    journalA.post(ids.generate(), clock.now());
    journalB.post(ids.generate(), clock.now());

    await unitOfWork.run((tx) => journals.append(journalA, tenantId, tx));
    await unitOfWork.run((tx) => journals.append(journalB, otherTenantId, tx));

    expect(await journals.findById(journalA.id.toString(), otherTenantId)).toBeNull();
    expect(await journals.findById(journalB.id.toString(), tenantId)).toBeNull();

    const bySourceRefA = await journals.findBySourceRef(sourceRef, tenantId);
    expect(bySourceRefA.some((j) => j.id.toString() === journalB.id.toString())).toBe(false);

    expect(await journals.findByAccount(debitB, tenantId)).toHaveLength(0);
    expect(await journals.findByAccount(debitA, otherTenantId)).toHaveLength(0);
    await prisma.$disconnect();
  });
});
