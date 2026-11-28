import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PrismaOutboxEventPublisher } from "./prisma-outbox-event-publisher";

const MESSAGE_ID = "0192f0aa-0000-7000-8000-000000000001";
const NOW = new Date("2026-11-27T12:00:00.000Z");

function record(overrides: Partial<Parameters<PrismaOutboxEventPublisher["publish"]>[0]> = {}) {
  return {
    topic: "tracking.event.captured.v1",
    key: "shop-1",
    value: new TextEncoder().encode('{"hello":"world"}'),
    headers: {
      messageId: MESSAGE_ID,
      contentType: "application/json",
      tenantId: "shop-1",
      producer: "tracking-edge",
    },
    ...overrides,
  };
}

/** A Prisma-shaped fake that records, in order, the tenant scope and the outbox inserts. */
function fakePrisma() {
  const calls: { kind: "scope" | "createMany"; value: unknown }[] = [];
  let failInsert = false;
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ kind: "scope", value: { sql: strings.join("?"), values } });
      return Promise.resolve(1);
    },
    outboxEntry: {
      createMany: (args: unknown) => {
        if (failInsert) return Promise.reject(new Error("database is down"));
        calls.push({ kind: "createMany", value: args });
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const prisma = { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  return {
    prisma: prisma as unknown as PrismaClient,
    calls,
    failNext: () => {
      failInsert = true;
    },
  };
}

describe("PrismaOutboxEventPublisher", () => {
  it("appends one pending row keyed by the message id, inside the tenant's scope", async () => {
    const { prisma, calls } = fakePrisma();

    await new PrismaOutboxEventPublisher(prisma, () => NOW).publish(record());

    expect(calls.map((c) => c.kind)).toEqual(["scope", "createMany"]);
    expect(calls[0]?.value).toMatchObject({
      sql: expect.stringContaining("set_config('app.tenant_id'"),
      values: ["shop-1"],
    });
    const args = calls[1]?.value as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toEqual([
      expect.objectContaining({
        id: MESSAGE_ID,
        topic: "tracking.event.captured.v1",
        key: "shop-1",
        contentType: "application/json",
        status: "pending",
        tenantId: "shop-1",
        producer: "tracking-edge",
        createdAt: NOW,
      }),
    ]);
    expect(Array.from(args.data[0]?.["payload"] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode('{"hello":"world"}')),
    );
  });

  it("refuses a record with no tenantId header — an untenanted row is un-attributable (G-64)", async () => {
    const { prisma, calls } = fakePrisma();
    const untenanted = record({ headers: { messageId: MESSAGE_ID } });

    await expect(new PrismaOutboxEventPublisher(prisma).publish(untenanted)).rejects.toThrow(
      /no tenantId/,
    );
    expect(calls).toEqual([]);
  });

  it("refuses a message id that is not a UUID (the column cannot hold it)", async () => {
    const { prisma, calls } = fakePrisma();
    const bad = record({ headers: { messageId: "lead_42", tenantId: "shop-1" } });

    await expect(new PrismaOutboxEventPublisher(prisma).publish(bad)).rejects.toThrow(/not a UUID/);
    expect(calls).toEqual([]);
  });

  it("scopes each tenant's rows to that tenant when a batch mixes tenants", async () => {
    const { prisma, calls } = fakePrisma();
    const other = record({
      key: "shop-2",
      headers: { messageId: "0192f0aa-0000-7000-8000-000000000002", tenantId: "shop-2" },
    });

    await new PrismaOutboxEventPublisher(prisma, () => NOW).publishBatch([record(), other]);

    expect(calls.map((c) => c.kind)).toEqual(["scope", "createMany", "scope", "createMany"]);
    expect((calls[0]?.value as { values: unknown[] }).values).toEqual(["shop-1"]);
    expect((calls[2]?.value as { values: unknown[] }).values).toEqual(["shop-2"]);
  });

  it("surfaces a database failure to the caller (the route then answers a retryable 503)", async () => {
    const { prisma, failNext } = fakePrisma();
    failNext();

    await expect(new PrismaOutboxEventPublisher(prisma).publish(record())).rejects.toThrow(
      "database is down",
    );
  });
});
