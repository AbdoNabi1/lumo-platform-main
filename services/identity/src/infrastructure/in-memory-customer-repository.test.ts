import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { ConflictError } from "@platform/utils";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
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
    const page = await repository.list({}, "tenant-1");
    expect(page).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });

  it("returns saved customers, most recently registered first", async () => {
    const { repository, nextId } = wire();
    const alice = register(nextId, "Alice", "alice@example.com");
    const bob = register(nextId, "Bob", "bob@example.com");
    await repository.save(alice, "tenant-1");
    await repository.save(bob, "tenant-1");

    const page = await repository.list({}, "tenant-1");
    expect(page.items.map((c) => c.name)).toEqual(["Bob", "Alice"]);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  it("filters by a case-insensitive name/email substring", async () => {
    const { repository, nextId } = wire();
    await repository.save(register(nextId, "Alice", "alice@example.com"), "tenant-1");
    await repository.save(register(nextId, "Bob", "bob@example.com"), "tenant-1");

    const byName = await repository.list({ search: "ali" }, "tenant-1");
    expect(byName.items.map((c) => c.name)).toEqual(["Alice"]);

    const byEmail = await repository.list({ search: "BOB@EXAMPLE" }, "tenant-1");
    expect(byEmail.items.map((c) => c.name)).toEqual(["Bob"]);
  });

  it("paginates with a cursor", async () => {
    const { repository, nextId } = wire();
    const alice = register(nextId, "Alice", "alice@example.com");
    const bob = register(nextId, "Bob", "bob@example.com");
    await repository.save(alice, "tenant-1");
    await repository.save(bob, "tenant-1");

    const firstPage = await repository.list({ first: 1 }, "tenant-1");
    expect(firstPage.items.map((c) => c.name)).toEqual(["Bob"]);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.endCursor).not.toBeNull();

    const secondPage = await repository.list(
      {
        first: 1,
        after: firstPage.pageInfo.endCursor ?? undefined,
      },
      "tenant-1",
    );
    expect(secondPage.items.map((c) => c.name)).toEqual(["Alice"]);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("InMemoryCustomerRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
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

  it("does not let tenant A read tenant B's customer by id, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const customer = register(nextId, "Alice", "alice@example.com");
    await repository.save(customer, "tenant-a");

    expect(await repository.findById(customer.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(customer.id.toString(), "tenant-b")).toBeNull();
  });

  it("does not let tenant A read tenant B's customer by email, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const customer = register(nextId, "Alice", "alice@example.com");
    await repository.save(customer, "tenant-a");

    expect(await repository.findByEmail("alice@example.com", "tenant-a")).not.toBeNull();
    expect(await repository.findByEmail("alice@example.com", "tenant-b")).toBeNull();
  });

  it("does not let tenant A list tenant B's customers, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    await repository.save(register(nextId, "Alice", "alice@example.com"), "tenant-a");
    await repository.save(register(nextId, "Bob", "bob@example.com"), "tenant-b");

    const tenantAPage = await repository.list({}, "tenant-a");
    const tenantBPage = await repository.list({}, "tenant-b");

    expect(tenantAPage.items.map((c) => c.name)).toEqual(["Alice"]);
    expect(tenantBPage.items.map((c) => c.name)).toEqual(["Bob"]);
  });
});

describe("InMemoryCustomerRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("identity", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryCustomerRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = Customer.register(
        UniqueEntityId.from(nextId()),
        must(Email.create("ann@example.com")),
        "Ann",
        nextId(),
        new Date(0),
      );
      await repository.save(agg, tenantId);
    });
  });
});

describe("InMemoryCustomerRepository — (tenantId, email) uniqueness (WP-1)", () => {
  function wire() {
    const nextId = monotonicIds();
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date("2026-09-21T00:00:00.000Z") },
      producer: "identity",
    });
    const repository = new InMemoryCustomerRepository({
      outbox,
      context: rootEventContext({ generate: nextId }),
    });
    const make = (email: string): Customer =>
      Customer.register(
        UniqueEntityId.from(nextId()),
        must(Email.create(email)),
        "n",
        nextId(),
        new Date(0),
      );
    return { repository, make };
  }

  it("rejects a second customer with the same email in the same tenant with a ConflictError", async () => {
    const { repository, make } = wire();
    await repository.save(make("dup@example.com"), "tenant-1");

    await expect(repository.save(make("dup@example.com"), "tenant-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("allows the same email in a different tenant", async () => {
    const { repository, make } = wire();
    await repository.save(make("dup@example.com"), "tenant-1");

    await expect(repository.save(make("dup@example.com"), "tenant-2")).resolves.toBeUndefined();
  });

  it("re-saving the same customer is not a conflict", async () => {
    const { repository, make } = wire();
    const customer = make("same@example.com");
    await repository.save(customer, "tenant-1");

    await expect(repository.save(customer, "tenant-1")).resolves.toBeUndefined();
  });
});
