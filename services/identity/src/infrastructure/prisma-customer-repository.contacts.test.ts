import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import type { Database } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { PrismaCustomerRepository } from "./prisma-customer-repository";

const ALICE = "01900000-0000-7000-8000-000000000001";
const BOB = "01900000-0000-7000-8000-000000000002";
const ERASED = "01900000-0000-7000-8000-000000000003";
const THEIRS = "01900000-0000-7000-8000-000000000004";

function row(
  id: string,
  tenantId: string,
  name: string,
  email: string,
  deletedAt: Date | null,
  isGuest = false,
) {
  return { id, tenantId, name, email, isGuest, deletedAt };
}

type Call = (args: unknown) => unknown;

/** Wraps `customer.findMany` on the fake transaction client so a test can see exactly what was asked. */
async function repositoryOver(rows: ReturnType<typeof row>[]) {
  const fake = createFakePrisma();
  for (const seeded of rows) {
    await fake.database.customer.create({ data: seeded as never });
  }
  const asked: unknown[] = [];
  const database = new Proxy(fake.database as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== "$transaction") return value;
      return (fn: (tx: unknown) => Promise<unknown>) =>
        (value as (f: (tx: unknown) => Promise<unknown>) => Promise<unknown>)((tx) =>
          fn(
            new Proxy(tx as object, {
              get(inner, key, innerReceiver) {
                const found = Reflect.get(inner, key, innerReceiver) as unknown;
                if (key !== "customer") return found;
                return new Proxy(found as object, {
                  get(model, method, modelReceiver) {
                    const call = Reflect.get(model, method, modelReceiver) as unknown;
                    if (method !== "findMany") return call;
                    return (args: unknown) => {
                      asked.push(args);
                      return (call as Call)(args);
                    };
                  },
                });
              },
            }),
          ),
        );
    },
  }) as Database;
  const repository = new PrismaCustomerRepository({
    prisma: database,
    outbox: undefined as unknown as OutboxWriter<never>,
    context: undefined as unknown as EventContext,
  });
  return { repository, asked };
}

describe("PrismaCustomerRepository.findContactsByIds", () => {
  const rows = [
    row(ALICE, "tenant-a", "Alice", "alice@example.com", null),
    row(BOB, "tenant-a", "bob", "bob@example.com", null, true),
    row(ERASED, "tenant-a", "Erased", "erased@example.com", new Date(0)),
    row(THEIRS, "tenant-b", "Mallory", "mallory@example.com", null),
  ];

  it("answers the contacts of the tenants live customers, in one query", async () => {
    const { repository, asked } = await repositoryOver(rows);

    const contacts = await repository.findContactsByIds([ALICE, BOB, ERASED, THEIRS], "tenant-a");

    expect(contacts).toEqual([
      { id: ALICE, name: "Alice", email: "alice@example.com", isGuest: false },
      { id: BOB, name: "bob", email: "bob@example.com", isGuest: true },
    ]);
    expect(asked).toHaveLength(1);
  });

  it("scopes the query to the tenant", async () => {
    const { repository, asked } = await repositoryOver(rows);

    await repository.findContactsByIds([ALICE], "tenant-a");

    expect((asked[0] as { where: { tenantId: string } }).where.tenantId).toBe("tenant-a");
  });

  it("never sends an id that is not a UUID to the database (customer_ref is free text)", async () => {
    const { repository, asked } = await repositoryOver(rows);

    const contacts = await repository.findContactsByIds(["customer-1", ALICE, "guest"], "tenant-a");

    expect(contacts.map((contact) => contact.id)).toEqual([ALICE]);
    expect((asked[0] as { where: { id: { in: string[] } } }).where.id.in).toEqual([ALICE]);
  });

  it("does not query at all when no id is a UUID", async () => {
    const { repository, asked } = await repositoryOver(rows);

    const contacts = await repository.findContactsByIds(["customer-1"], "tenant-a");

    expect(contacts).toEqual([]);
    expect(asked).toHaveLength(0);
  });
});
