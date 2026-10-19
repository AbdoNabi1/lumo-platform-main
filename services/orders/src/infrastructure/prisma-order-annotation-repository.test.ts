import { describe, expect, it } from "vitest";
import { createFakePrisma } from "@platform/db/testing";
import type { Database, TransactionClient } from "@platform/db";
import { escapeLike, PrismaOrderAnnotationRepository } from "./prisma-order-annotation-repository";

const TENANT = "tenant-a";
const ORDER = "01900000-0000-7000-8000-00000000000a";
const FIRST = new Date("2026-07-01T00:00:00.000Z");
const SECOND = new Date("2026-07-02T00:00:00.000Z");

async function seeded(archivedAt: Date | null) {
  const fake = createFakePrisma();
  // fake-prisma has no column defaults: seed archivedAt explicitly.
  await fake.database.order.create({ data: { id: ORDER, tenantId: TENANT, archivedAt } as never });
  const repository = new PrismaOrderAnnotationRepository({ prisma: fake.database });
  const archivedAtNow = async () =>
    (await repository.annotationsOf([ORDER], TENANT, fake.database)).get(ORDER)?.archivedAt;
  return { fake, repository, archivedAtNow };
}

describe("PrismaOrderAnnotationRepository.setArchived (over fake-prisma)", () => {
  it("archives a live order once and reports it changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    expect(await repository.setArchived([ORDER], FIRST, TENANT, fake.database)).toEqual([ORDER]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });

  it("archiving an already-archived order is a no-op: not changed, timestamp untouched", async () => {
    const { fake, repository, archivedAtNow } = await seeded(FIRST);
    expect(await repository.setArchived([ORDER], SECOND, TENANT, fake.database)).toEqual([]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });

  it("unarchiving an order that is not archived is a no-op: not changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    expect(await repository.setArchived([ORDER], null, TENANT, fake.database)).toEqual([]);
    expect(await archivedAtNow()).toBeNull();
  });

  it("unarchives an archived order and reports it changed", async () => {
    const { fake, repository, archivedAtNow } = await seeded(FIRST);
    expect(await repository.setArchived([ORDER], null, TENANT, fake.database)).toEqual([ORDER]);
    expect(await archivedAtNow()).toBeNull();
  });

  it("a concurrent archive that lands first wins: ours reports unchanged and keeps its timestamp", async () => {
    const { fake, repository, archivedAtNow } = await seeded(null);
    // The other transaction commits between our read of the state and our write: the target-state
    // condition must live in the UPDATE itself, not in an earlier SELECT.
    const racing = new Proxy(fake.database, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== "order") return value;
        const order = value as { updateMany: (args: unknown) => Promise<unknown> };
        return new Proxy(order, {
          get(orderTarget, method, orderReceiver) {
            if (method !== "updateMany") return Reflect.get(orderTarget, method, orderReceiver);
            return async (args: unknown) => {
              await order.updateMany({ where: { id: ORDER }, data: { archivedAt: FIRST } });
              return order.updateMany(args);
            };
          },
        });
      },
    }) as unknown as TransactionClient;

    expect(await repository.setArchived([ORDER], SECOND, TENANT, racing)).toEqual([]);
    expect(await archivedAtNow()).toEqual(FIRST);
  });
});

const OTHER = "01900000-0000-7000-8000-00000000000b";
const THEIRS = "01900000-0000-7000-8000-00000000000c";

async function tagged() {
  const fake = createFakePrisma();
  for (const [id, tenantId] of [
    [ORDER, TENANT],
    [OTHER, TENANT],
    [THEIRS, "tenant-b"],
  ] as const) {
    await fake.database.order.create({
      data: { id, tenantId, archivedAt: null, note: null } as never,
    });
  }
  const repository = new PrismaOrderAnnotationRepository({ prisma: fake.database });
  return { fake, repository, tx: fake.database };
}

describe("PrismaOrderAnnotationRepository note and tags (Part 2, over fake-prisma)", () => {
  it("setNote writes the note of this shop's order and answers false for another shop's", async () => {
    const { repository, tx } = await tagged();
    expect(await repository.setNote(ORDER, "Ring twice", TENANT, tx)).toBe(true);
    expect(await repository.setNote(THEIRS, "mine now", TENANT, tx)).toBe(false);
    expect(await repository.setNote("not-a-uuid", "x", TENANT, tx)).toBe(false);
    expect((await repository.annotationsOf([ORDER], TENANT, tx)).get(ORDER)?.note).toBe(
      "Ring twice",
    );
  });

  it("addTags adds only missing keys, skips other shops' orders, and answers what it added", async () => {
    const { fake, repository, tx } = await tagged();
    await repository.addTags([ORDER], [{ tag: "VIP", tagKey: "vip" }], TENANT, tx);
    const added = await repository.addTags(
      [ORDER, OTHER, THEIRS],
      [
        { tag: "vip", tagKey: "vip" },
        { tag: "Urgent", tagKey: "urgent" },
      ],
      TENANT,
      tx,
    );
    expect([...added]).toEqual([
      [ORDER, ["Urgent"]],
      [OTHER, ["vip", "Urgent"]],
    ]);
    expect(fake.rowsOf("orderTag").filter((row) => row["orderId"] === THEIRS)).toEqual([]);
    expect((await repository.annotationsOf([ORDER], TENANT, tx)).get(ORDER)?.tags).toEqual([
      "Urgent",
      "VIP",
    ]);
  });

  it("addTags reports only the rows its insert wrote when a concurrent add commits first", async () => {
    // Task 3 (carried from Task 2's review): our pre-insert read misses a "vip" row another
    // transaction commits just after it; ON CONFLICT DO NOTHING then skips that row, and the answer
    // (which becomes the `tags_added` line) must not claim it.
    const { fake, repository } = await tagged();
    const inserts: { data: Record<string, unknown>[]; skipDuplicates?: boolean }[] = [];
    const racing = {
      order: fake.database.order,
      orderTag: {
        findMany: async () => [],
        createManyAndReturn: async (args: {
          data: Record<string, unknown>[];
          skipDuplicates?: boolean;
        }) => {
          inserts.push(args);
          return args.data
            .filter((row) => row["tagKey"] !== "vip")
            .map((row) => ({ orderId: row["orderId"], tagKey: row["tagKey"] }));
        },
      },
    } as unknown as TransactionClient;
    const added = await repository.addTags(
      [ORDER],
      [
        { tag: "VIP", tagKey: "vip" },
        { tag: "Urgent", tagKey: "urgent" },
      ],
      TENANT,
      racing,
    );
    expect([...added]).toEqual([[ORDER, ["Urgent"]]]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.skipDuplicates).toBe(true);
    expect(inserts[0]?.data.map((row) => row["tagKey"])).toEqual(["vip", "urgent"]);
  });

  it("removeTags removes by key and answers the stored spellings", async () => {
    const { repository, tx } = await tagged();
    await repository.addTags([ORDER], [{ tag: "VIP", tagKey: "vip" }], TENANT, tx);
    expect([...(await repository.removeTags([ORDER, OTHER], ["vip"], TENANT, tx))]).toEqual([
      [ORDER, ["VIP"]],
    ]);
    expect((await repository.removeTags([ORDER], ["vip"], TENANT, tx)).size).toBe(0);
  });

  it("writes need the unit of work's transaction", async () => {
    const { repository } = await tagged();
    await expect(repository.setNote(ORDER, "x", TENANT)).rejects.toThrow(/transaction/);
    await expect(repository.addTags([ORDER], [{ tag: "a", tagKey: "a" }], TENANT)).rejects.toThrow(
      /transaction/,
    );
    await expect(repository.removeTags([ORDER], ["a"], TENANT)).rejects.toThrow(/transaction/);
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("50%_off\\x")).toBe("50\\%\\_off\\\\x");
  });
});

describe("PrismaOrderAnnotationRepository.tagsInUse (raw SQL)", () => {
  function rawDatabase(answer: readonly Record<string, unknown>[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const client = {
      $executeRaw: async () => 0,
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.join("?").replace(/\s+/g, " "), values });
        return answer;
      },
    };
    const database = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    } as unknown as Database;
    return { database, calls };
  }

  it("scopes to the tenant, matches the prefix literally and caps the limit at 50 (Review Focus 1)", async () => {
    const { database, calls } = rawDatabase([{ tag: "50% off", count: 3 }]);
    const repository = new PrismaOrderAnnotationRepository({ prisma: database });
    expect(await repository.tagsInUse("tenant-a", "  50%_Off\\ ", 500)).toEqual([
      { tag: "50% off", count: 3 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('"tenant_id" = ?');
    expect(calls[0]?.sql).toContain("ESCAPE");
    expect(calls[0]?.values).toEqual(["tenant-a", "50\\%\\_off\\\\%", 50]);
  });

  it("with no prefix asks for every tag of the shop", async () => {
    const { database, calls } = rawDatabase([]);
    await new PrismaOrderAnnotationRepository({ prisma: database }).tagsInUse("tenant-a");
    expect(calls[0]?.values).toEqual(["tenant-a", "%", 50]);
  });
});
