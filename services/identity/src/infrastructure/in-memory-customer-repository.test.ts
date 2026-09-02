import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Customer } from "../domain/customer";
import { Email } from "../domain/value-objects/email";
import { IdentityEventTranslator } from "./identity-event-translator";
import { InMemoryCustomerRepository } from "./in-memory-customer-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

describe("InMemoryCustomerRepository.list", () => {
  function wire() {
    const nextId = monotonicIds();
    const outboxStore = new InMemoryOutboxStore();
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
      producer: "identity",
    });
    const context = rootEventContext({ generate: nextId });
    const repository = new InMemoryCustomerRepository({ outbox, context });
    return { repository, nextId };
  }

  function register(nextId: () => string, name: string, email: string): Customer {
    return Customer.register(
      UniqueEntityId.from(nextId()),
      must(Email.create(email)),
      name,
      nextId(),
      new Date(0),
    );
  }

  it("returns an empty page when no customers have been saved", async () => {
    const { repository } = wire();
    const page = await repository.list({});
    expect(page).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });

  it("returns saved customers, most recently registered first", async () => {
    const { repository, nextId } = wire();
    const alice = register(nextId, "Alice", "alice@example.com");
    const bob = register(nextId, "Bob", "bob@example.com");
    await repository.save(alice);
    await repository.save(bob);

    const page = await repository.list({});
    expect(page.items.map((c) => c.name)).toEqual(["Bob", "Alice"]);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  it("filters by a case-insensitive name/email substring", async () => {
    const { repository, nextId } = wire();
    await repository.save(register(nextId, "Alice", "alice@example.com"));
    await repository.save(register(nextId, "Bob", "bob@example.com"));

    const byName = await repository.list({ search: "ali" });
    expect(byName.items.map((c) => c.name)).toEqual(["Alice"]);

    const byEmail = await repository.list({ search: "BOB@EXAMPLE" });
    expect(byEmail.items.map((c) => c.name)).toEqual(["Bob"]);
  });

  it("paginates with a cursor", async () => {
    const { repository, nextId } = wire();
    const alice = register(nextId, "Alice", "alice@example.com");
    const bob = register(nextId, "Bob", "bob@example.com");
    await repository.save(alice);
    await repository.save(bob);

    const firstPage = await repository.list({ first: 1 });
    expect(firstPage.items.map((c) => c.name)).toEqual(["Bob"]);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.endCursor).not.toBeNull();

    const secondPage = await repository.list({
      first: 1,
      after: firstPage.pageInfo.endCursor ?? undefined,
    });
    expect(secondPage.items.map((c) => c.name)).toEqual(["Alice"]);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});
