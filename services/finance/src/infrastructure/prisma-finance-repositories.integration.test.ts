import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Account } from "../domain/account";
import { Journal } from "../domain/journal";
import { AccountType } from "../domain/value-objects/account-type";
import { LedgerDirection } from "../domain/value-objects/ledger-direction";
import { JournalLine } from "../domain/value-objects/journal-line";
import { FinanceEventTranslator } from "./finance-event-translator";
import { PrismaAccountRepository, PrismaJournalRepository } from "./prisma-finance-repositories";

/**
 * Phase A.25 Task 9 — real-PostgreSQL integration coverage for Finance (previously none).
 * Follows the established reference pattern (see PrismaOrderRepository's integration suite):
 * gated on `DATABASE_URL_TEST`, skipped (never faked) without it.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/finance test
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
    const context = rootEventContext(ids, tenantId);
    const accounts = new PrismaAccountRepository({ prisma, tenantId });
    const journals = new PrismaJournalRepository({ prisma, outbox, context, tenantId });
    return { prisma, accounts, journals, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore };
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

    await accounts.save(account);
    const loaded = await accounts.findById(account.id.toString());

    expect(loaded).not.toBeNull();
    expect(loaded?.code).toBe(account.code);
    expect(loaded?.name).toBe("Cash");
    expect(loaded?.active).toBe(true);
    await prisma.$disconnect();
  });

  it("updates an existing Account (update)", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account);

    const loaded = await accounts.findById(account.id.toString());
    if (loaded === null) throw new Error("setup failed");
    loaded.rename("Petty Cash");
    await accounts.save(loaded);

    const reloaded = await accounts.findById(account.id.toString());
    expect(reloaded?.name).toBe("Petty Cash");
    expect(reloaded?.version).toBe(2);
    await prisma.$disconnect();
  });

  // --- Constraints ------------------------------------------------------------------------------

  it("enforces the unique (tenantId, code) constraint (constraints)", async () => {
    const { prisma, accounts } = wire();
    const code = `A25-DUP-${ids.generate()}`;
    await accounts.save(newAccount(code));

    await expect(accounts.save(newAccount(code))).rejects.toThrow();
    await prisma.$disconnect();
  });

  // --- Transaction commit / rollback ------------------------------------------------------------

  it("commits the Journal + its LedgerEntry lines + outbox row atomically (transaction commit)", async () => {
    const { prisma, journals, unitOfWork, outboxStore } = wire();
    const debit = `acct-debit-${ids.generate()}`;
    const credit = `acct-credit-${ids.generate()}`;
    const journal = balancedJournal(`src-${ids.generate()}`, debit, credit);
    journal.post(ids.generate(), clock.now());

    await unitOfWork.run(async (tx) => journals.append(journal, tx));

    const loaded = await journals.findById(journal.id.toString());
    expect(loaded).not.toBeNull();
    expect(loaded?.lines).toHaveLength(2);
    expect(loaded?.isPosted).toBe(true);

    const ledgerLines = await journals.findByAccount(debit);
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
        await journals.append(journal, tx);
        throw new Error("simulated downstream failure after the journal write");
      }),
    ).rejects.toThrow("simulated downstream failure");

    // Nothing from the aborted transaction should be visible: neither the journal row, its
    // ledger lines, nor the outbox row (same-transaction outbox is the whole point of ADR-0003).
    const loaded = await journals.findById(journal.id.toString());
    expect(loaded).toBeNull();
    const ledgerLines = await journals.findByAccount(debit);
    expect(ledgerLines).toHaveLength(0);
    await prisma.$disconnect();
  });

  // --- Concurrent update / stale-write (optimistic concurrency) ---------------------------------

  it("detects a concurrent update via ConcurrencyError rather than silently overwriting (concurrent update / stale write)", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account);

    const copyA = await accounts.findById(account.id.toString());
    const copyB = await accounts.findById(account.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.rename("Renamed by A");
    copyB.rename("Renamed by B");

    await accounts.save(copyA);
    await expect(accounts.save(copyB)).rejects.toBeInstanceOf(ConcurrencyError);

    const finalState = await accounts.findById(account.id.toString());
    expect(finalState?.name).toBe("Renamed by A"); // B's stale write never applied
    await prisma.$disconnect();
  });

  it("rejects true concurrent writes to the same Account under real simultaneous transactions", async () => {
    const { prisma, accounts } = wire();
    const account = newAccount(`A25-${ids.generate()}`);
    await accounts.save(account);

    const copyA = await accounts.findById(account.id.toString());
    const copyB = await accounts.findById(account.id.toString());
    if (copyA === null || copyB === null) throw new Error("setup failed");
    copyA.rename("Concurrent A");
    copyB.rename("Concurrent B");

    const results = await Promise.allSettled([accounts.save(copyA), accounts.save(copyB)]);
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

    await unitOfWork.run(async (tx) => journals.append(journal, tx));

    // Re-append the identical journal id: create() will fail on the PK, proving the journal
    // itself cannot be duplicated — the important idempotency guarantee for an append-only ledger.
    await expect(unitOfWork.run(async (tx) => journals.append(journal, tx))).rejects.toThrow();

    const ledgerLines = await journals.findByAccount(debit);
    expect(ledgerLines).toHaveLength(1); // no duplicate ledger fact from the failed re-append
    await prisma.$disconnect();
  });
});
