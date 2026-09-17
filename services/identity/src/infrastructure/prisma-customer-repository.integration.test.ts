import { afterEach, describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import { Address } from "../domain/address";
import { Customer } from "../domain/customer";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import { Email } from "../domain/value-objects/email";
import { IdentityEventTranslator } from "./identity-event-translator";
import { PrismaCustomerRepository } from "./prisma-customer-repository";

/**
 * Integration suite for `PrismaCustomerRepository` — `Customer` (+`Address`, +`ConsentRecord`) on
 * the `identity` schema. Requires a real PostgreSQL with the
 * `20260712000000_identity_access_sprint41` migration applied:
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/identity test
 *
 * HONESTLY GATED: without `DATABASE_URL_TEST` the suite is skipped — never faked. Client creation
 * is lazy (inside `wire`, called within each `it`). ADR-0014 (WP-10, T10.3): every method now takes
 * `tenantId` as an explicit per-call parameter — `wire()` still returns a fresh `tenantId` per test
 * for isolation between test runs, but it is no longer baked into the repository instance itself.
 * Some cross-tenant tests below build two separately-wired repositories (mirroring how two
 * different requests would call in); the dedicated isolation test further down instead reuses a
 * SINGLE repository instance across two tenants, per T10.5's requirement.
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

function must<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

describe.runIf(Boolean(databaseUrl))("PrismaCustomerRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-15T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };
  const openClients: ReturnType<typeof createTestPrismaClient>[] = [];
  const usedTenantIds: string[] = [];

  afterEach(async () => {
    // Clean up exactly what THIS suite created — scoped strictly to the random tenant ids each
    // test generated (`customer.deleteMany` cascades to that tenant's addresses/consents via the
    // FK's `onDelete: Cascade`) — never a blanket delete that could touch another suite's or
    // historical rows.
    const client = openClients[0];
    if (client !== undefined && usedTenantIds.length > 0) {
      await client.customer.deleteMany({ where: { tenantId: { in: usedTenantIds.splice(0) } } });
    }
    // Only THIS suite ever writes `producer: "identity"` rows into the shared `platform.outbox`
    // table, so this can't touch another bounded context's (or another test file's) rows.
    if (client !== undefined) {
      await client.outboxEntry.deleteMany({ where: { producer: "identity" } });
    }
    await Promise.all(openClients.splice(0).map((c) => c.$disconnect()));
  });

  function wire(tenantId = `tenant-itest-${crypto.randomUUID()}`) {
    usedTenantIds.push(tenantId);
    const prisma = createTestPrismaClient(databaseUrl);
    openClients.push(prisma);
    const outboxStore = new PrismaOutboxStore(prisma);
    const outbox = new OutboxWriter({
      store: outboxStore,
      translator: new IdentityEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "identity",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaCustomerRepository({ prisma, outbox, context });
    return { prisma, repository, tenantId, unitOfWork: new PrismaUnitOfWork(prisma), outboxStore };
  }

  function email(local = crypto.randomUUID()): Email {
    return must(Email.create(`${local}@itest.example.com`));
  }

  function registerCustomer(em = email(), name = "Alice"): Customer {
    return Customer.register(
      UniqueEntityId.from(ids.generate()),
      em,
      name,
      ids.generate(),
      clock.now(),
    );
  }

  it("round-trips a registered customer: email (trimmed/lower-cased), name, version", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const em = must(Email.create("  Alice@ITest.Example.com  "));
    const customer = registerCustomer(em);

    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));
    const loaded = await repository.findById(customer.id.toString(), tenantId);

    expect(loaded).not.toBeNull();
    expect(loaded?.email.value).toBe("alice@itest.example.com");
    expect(loaded?.name).toBe("Alice");
    expect(loaded?.version).toBe(1);
    expect(loaded?.addresses).toHaveLength(0);
    expect(loaded?.consents).toHaveLength(0);
  });

  it("returns null for a nonexistent customer id", async () => {
    const { repository, tenantId } = wire();
    expect(await repository.findById(crypto.randomUUID(), tenantId)).toBeNull();
  });

  it("returns null from findByEmail for an email that was never registered", async () => {
    const { repository, tenantId } = wire();
    expect(await repository.findByEmail(email().value, tenantId)).toBeNull();
  });

  it("rejects a duplicate email within the same tenant (unique tenant_id+email)", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const em = email();
    const first = registerCustomer(em, "Alice");
    const second = registerCustomer(em, "Alice Clone");

    await unitOfWork.run((tx) => repository.save(first, tenantId, tx));
    await expect(unitOfWork.run((tx) => repository.save(second, tenantId, tx))).rejects.toThrow();
  });

  it("allows the SAME email across two different tenants and never leaks between them", async () => {
    const em = email();
    const a = wire();
    const b = wire();

    await a.unitOfWork.run((tx) =>
      a.repository.save(registerCustomer(em, "Alice Tenant A"), a.tenantId, tx),
    );
    await b.unitOfWork.run((tx) =>
      b.repository.save(registerCustomer(em, "Alice Tenant B"), b.tenantId, tx),
    );

    expect((await a.repository.findByEmail(em.value, a.tenantId))?.name).toBe("Alice Tenant A");
    expect((await b.repository.findByEmail(em.value, b.tenantId))?.name).toBe("Alice Tenant B");
  });

  it("does not leak one tenant's customer through a repository wired to a different tenant", async () => {
    const a = wire();
    const b = wire();
    const customer = registerCustomer();
    await a.unitOfWork.run((tx) => a.repository.save(customer, a.tenantId, tx));

    expect(await b.repository.findById(customer.id.toString(), b.tenantId)).toBeNull();
    expect(await b.repository.findByEmail(customer.email.value, b.tenantId)).toBeNull();
  });

  it("does not let tenant A read tenant B's customer through a SINGLE shared repository instance (ADR-0014, WP-10 T10.5)", async () => {
    const { repository, unitOfWork } = wire();
    const tenantA = `tenant-itest-a-${crypto.randomUUID()}`;
    const tenantB = `tenant-itest-b-${crypto.randomUUID()}`;
    usedTenantIds.push(tenantA, tenantB);
    const customerA = registerCustomer(email(), "Alice");

    await unitOfWork.run((tx) => repository.save(customerA, tenantA, tx));

    expect(await repository.findById(customerA.id.toString(), tenantA)).not.toBeNull();
    expect(await repository.findById(customerA.id.toString(), tenantB)).toBeNull();
    expect(await repository.findByEmail(customerA.email.value, tenantA)).not.toBeNull();
    expect(await repository.findByEmail(customerA.email.value, tenantB)).toBeNull();
    const pageA = await repository.list({}, tenantA);
    const pageB = await repository.list({}, tenantB);
    expect(pageA.items.map((c) => c.id.toString())).toContain(customerA.id.toString());
    expect(pageB.items.map((c) => c.id.toString())).not.toContain(customerA.id.toString());
  });

  it("addAddress persists the address and preserves insertion order across multiple adds", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    let loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    const addr1 = must(
      Address.create(UniqueEntityId.from(ids.generate()), "1 Main St", "Town", "11111", "US"),
    );
    loaded.addAddress(addr1);
    await unitOfWork.run((tx) => repository.save(loaded as Customer, tenantId, tx));

    loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("reload failed");
    const addr2 = must(
      Address.create(UniqueEntityId.from(ids.generate()), "2 Side St", "Town", "22222", "US"),
    );
    loaded.addAddress(addr2);
    await unitOfWork.run((tx) => repository.save(loaded as Customer, tenantId, tx));

    const final = await repository.findById(customer.id.toString(), tenantId);
    expect(final?.addresses).toHaveLength(2);
    expect(final?.addresses[0]?.line1).toBe("1 Main St");
    expect(final?.addresses[1]?.line1).toBe("2 Side St");
  });

  it("rejects an address referencing a nonexistent customer (FK enforced at the database)", async () => {
    // The domain never allows this (an address is only ever created off an already-loaded
    // Customer aggregate) — going under the repository/mapper directly is the only way to prove
    // the `addresses_customer_id_fkey` constraint actually exists and is enforced.
    const { prisma } = wire();
    await expect(
      prisma.address.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: `tenant-itest-${crypto.randomUUID()}`,
          customerId: crypto.randomUUID(), // no such customer
          line1: "1 Main St",
          city: "Town",
          postalCode: "11111",
          country: "US",
        },
      }),
    ).rejects.toThrow();
  });

  it("changeConsent appends to the log; current consent derives from the latest record per scope", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    let loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.changeConsent(
      UniqueEntityId.from(ids.generate()),
      must(ConsentScope.create("marketing")),
      true,
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => repository.save(loaded as Customer, tenantId, tx));

    loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("reload failed");
    expect(loaded.consentFor(must(ConsentScope.create("marketing")))).toBe(true);

    // Revoke — a NEW append-only row, not an update of the previous one.
    loaded.changeConsent(
      UniqueEntityId.from(ids.generate()),
      must(ConsentScope.create("marketing")),
      false,
      ids.generate(),
      new Date(clock.now().getTime() + 1000),
    );
    await unitOfWork.run((tx) => repository.save(loaded as Customer, tenantId, tx));

    const final = await repository.findById(customer.id.toString(), tenantId);
    expect(final?.consents).toHaveLength(2);
    expect(final?.consentFor(must(ConsentScope.create("marketing")))).toBe(false);
  });

  it("consent log is genuinely append-only: unrelated scopes don't interfere with each other", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    const loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.changeConsent(
      UniqueEntityId.from(ids.generate()),
      must(ConsentScope.create("marketing")),
      true,
      ids.generate(),
      clock.now(),
    );
    loaded.changeConsent(
      UniqueEntityId.from(ids.generate()),
      must(ConsentScope.create("analytics")),
      false,
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => repository.save(loaded as Customer, tenantId, tx));

    const final = await repository.findById(customer.id.toString(), tenantId);
    expect(final?.consentFor(must(ConsentScope.create("marketing")))).toBe(true);
    expect(final?.consentFor(must(ConsentScope.create("analytics")))).toBe(false);
    expect(final?.consentFor(must(ConsentScope.create("data_sharing")))).toBe(false); // never granted, default false
  });

  it("cross-customer isolation: one customer's addresses/consents never appear under another's id", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const customerA = registerCustomer();
    const customerB = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customerA, tenantId, tx));
    await unitOfWork.run((tx) => repository.save(customerB, tenantId, tx));

    const loadedA = await repository.findById(customerA.id.toString(), tenantId);
    if (loadedA === null) throw new Error("setup failed");
    loadedA.addAddress(
      must(Address.create(UniqueEntityId.from(ids.generate()), "A St", "Town", "11111", "US")),
    );
    await unitOfWork.run((tx) => repository.save(loadedA as Customer, tenantId, tx));

    const reloadedB = await repository.findById(customerB.id.toString(), tenantId);
    expect(reloadedB?.addresses).toHaveLength(0);
    const reloadedA = await repository.findById(customerA.id.toString(), tenantId);
    expect(reloadedA?.addresses).toHaveLength(1);
  });

  it("rejects a stale write with ConcurrencyError — the losing writer's address is never persisted", async () => {
    const { repository, tenantId, unitOfWork, prisma } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    const first = await repository.findById(customer.id.toString(), tenantId);
    const second = await repository.findById(customer.id.toString(), tenantId);
    if (first === null || second === null) throw new Error("setup failed");
    first.addAddress(
      must(Address.create(UniqueEntityId.from(ids.generate()), "First St", "Town", "11111", "US")),
    );
    second.addAddress(
      must(Address.create(UniqueEntityId.from(ids.generate()), "Second St", "Town", "22222", "US")),
    );

    await unitOfWork.run((tx) => repository.save(first, tenantId, tx));
    await expect(
      unitOfWork.run((tx) => repository.save(second, tenantId, tx)),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    const final = await repository.findById(customer.id.toString(), tenantId);
    expect(final?.addresses).toHaveLength(1);
    expect(final?.addresses[0]?.line1).toBe("First St");
    expect(final?.version).toBe(2);

    // The second writer's address was never inserted at all (the whole transaction, including the
    // customer version bump AND the address insert, rolled back together).
    const orphanCount = await prisma.address.count({ where: { line1: "Second St" } });
    expect(orphanCount).toBe(0);
  });

  it("does not persist a partial write when the transaction fails after save()", async () => {
    const { repository, tenantId, unitOfWork } = wire();
    const customer = registerCustomer();

    await expect(
      unitOfWork.run(async (tx) => {
        await repository.save(customer, tenantId, tx);
        throw new Error("simulated failure after write");
      }),
    ).rejects.toThrow("simulated failure");

    expect(await repository.findById(customer.id.toString(), tenantId)).toBeNull();
  });

  it("writes the outbox row (customer.registered) in the SAME transaction as the aggregate", async () => {
    const { repository, tenantId, unitOfWork, prisma } = wire();
    const customer = registerCustomer();

    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));
    // Scoped by key rather than `outboxStore.fetchPending(N)`'s global oldest-first window, which
    // the shared `platform.outbox` table's concurrent writers from every other bounded context's
    // integration suite can push this row outside of under a full-monorepo parallel test run.
    const rows = await prisma.outboxEntry.findMany({ where: { key: customer.id.toString() } });
    expect(rows.some((e) => e.topic.includes("registered"))).toBe(true);
  });

  it("writes the outbox row (consent.changed) in the SAME transaction as the consent append", async () => {
    const { repository, tenantId, unitOfWork, prisma } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    const loaded = await repository.findById(customer.id.toString(), tenantId);
    if (loaded === null) throw new Error("setup failed");
    loaded.changeConsent(
      UniqueEntityId.from(ids.generate()),
      must(ConsentScope.create("marketing")),
      true,
      ids.generate(),
      clock.now(),
    );
    await unitOfWork.run((tx) => repository.save(loaded, tenantId, tx));

    // Scoped by key — see note above.
    const rows = await prisma.outboxEntry.findMany({ where: { key: customer.id.toString() } });
    expect(rows.some((e) => e.topic.includes("consent_changed"))).toBe(true);
  });

  it("assigns real UUIDs and sets createdAt/updatedAt timestamps on the persisted row", async () => {
    const { repository, tenantId, unitOfWork, prisma } = wire();
    const customer = registerCustomer();
    await unitOfWork.run((tx) => repository.save(customer, tenantId, tx));

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id.toString() } });
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(row.id).toMatch(uuidPattern);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });
});
