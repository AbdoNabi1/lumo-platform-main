import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { LoyaltyAccount } from "../domain/loyalty-account";
import { DEFAULT_TIERS } from "../composition";
import { LoyaltyEventTranslator } from "./loyalty-event-translator";
import { InMemoryLoyaltyAccountRepository } from "./in-memory-loyalty-account-repository";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new LoyaltyEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "loyalty",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryLoyaltyAccountRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryLoyaltyAccountRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's account by id, customerRef, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const account = LoyaltyAccount.create(
      UniqueEntityId.from(nextId()),
      "customer-1",
      DEFAULT_TIERS,
    );
    await repository.save(account, "tenant-a");

    expect(await repository.findById(account.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(account.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByCustomerRef("customer-1", "tenant-a")).not.toBeNull();
    expect(await repository.findByCustomerRef("customer-1", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((a) => a.id.toString())).toContain(account.id.toString());
    expect(pageB.items.map((a) => a.id.toString())).not.toContain(account.id.toString());
  });
});

describe("InMemoryLoyaltyAccountRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("loyalty", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryLoyaltyAccountRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = LoyaltyAccount.create(UniqueEntityId.from(nextId()), "customer-1", DEFAULT_TIERS);
      agg.suspend(nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
