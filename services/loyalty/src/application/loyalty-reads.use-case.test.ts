import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetAccount } from "./get-account.use-case";
import { GetAccountByCustomer } from "./get-account-by-customer.use-case";
import { ListAccounts } from "./list-accounts.use-case";
import { OpenAccount } from "./loyalty.use-cases";
import { DEFAULT_TIERS } from "../composition";
import { InMemoryLoyaltyAccountRepository } from "../infrastructure/in-memory-loyalty-account-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { LoyaltyEventTranslator } from "../infrastructure/loyalty-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new LoyaltyEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "loyalty",
  });
  const context = rootEventContext(sequentialIds());
  const accounts = new InMemoryLoyaltyAccountRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { accounts, unitOfWork, idGenerator, clock, tiers: DEFAULT_TIERS };
}

describe("Loyalty read use-cases (Phase 4 T4.4)", () => {
  it("ListAccounts paginates", async () => {
    const h = harness();
    const open = new OpenAccount(h);
    for (let i = 0; i < 3; i += 1) {
      await open.execute({ customerRef: `customer-${i}`, tenantId: "tenant-1" });
    }

    const page = await new ListAccounts(h).execute({ first: 2, tenantId: "tenant-1" });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListAccounts(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
      tenantId: "tenant-1",
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetAccount returns the account (with its balance), or NotFoundError when absent", async () => {
    const h = harness();
    const opened = await new OpenAccount(h).execute({
      customerRef: "customer-1",
      tenantId: "tenant-1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const found = await new GetAccount(h).execute({
      accountId: opened.value.accountId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(opened.value.accountId);
    expect(found.value.points.balance).toBe(0);

    const missing = await new GetAccount(h).execute({ accountId: "nope", tenantId: "tenant-1" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("GetAccountByCustomer returns the customer's own account, or NotFoundError when they have none (T5.19)", async () => {
    const h = harness();
    const opened = await new OpenAccount(h).execute({
      customerRef: "customer-1",
      tenantId: "tenant-1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const found = await new GetAccountByCustomer(h).execute({
      customerRef: "customer-1",
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(opened.value.accountId);
    expect(found.value.customerRef).toBe("customer-1");

    const missing = await new GetAccountByCustomer(h).execute({
      customerRef: "customer-none",
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
