import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import type { IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { PaymentIntent } from "../domain/payment-intent";
import { PspToken } from "../domain/value-objects/psp-token";
import { PaymentEventTranslator } from "./payment-event-translator";
import { PrismaPaymentIntentRepository } from "./prisma-payment-intent-repository";

/**
 * G-76 — CLOSED. `refund.upsert({ where: { id: refund.id }, ... })` addressed the row by id alone;
 * refund ids are server-generated on the tenant-scoped aggregate so this was not reachable through
 * any route today, but an id collision (bug elsewhere, or a future caller) would have let one
 * tenant's settlement land on another tenant's refund row. Fixed by scoping the update to
 * `(id, tenantId)` and falling back to `create` only when that scoped update matches nothing — an
 * id collision then fails on the row's own primary key instead of silently crossing tenants.
 */

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function pspToken(value: string): PspToken {
  const result = PspToken.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

interface RefundRow {
  id: string;
  tenantId: string;
  intentId: string;
  status: string;
  [k: string]: unknown;
}

function fakeTx() {
  const refunds: RefundRow[] = [];
  const client = {
    paymentIntent: {
      create: async () => undefined,
      updateMany: async () => ({ count: 1 }),
    },
    charge: {
      createMany: async () => undefined,
    },
    refund: {
      // Matches only on the keys actually PRESENT in `where` — a real Prisma `updateMany` places no
      // restriction on a field it is never told to filter by, so an omitted `tenantId` must match
      // every tenant's row, not none of them.
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const matches = refunds.filter((r) =>
          Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        );
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
      create: async ({ data }: { data: RefundRow }) => {
        if (refunds.some((r) => r.id === data.id)) {
          throw new Error("Unique constraint failed on the fields: (`id`)");
        }
        refunds.push({ ...data });
      },
    },
    paymentAttempt: {
      createMany: async () => undefined,
    },
  };
  return { client: client as unknown as TransactionClient, refunds };
}

function wireRepo() {
  const nextId = sequentialIds();
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new PaymentEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-09-26T00:00:00.000Z") },
    producer: "payments",
  });
  const repo = new PrismaPaymentIntentRepository({
    prisma: {} as never,
    outbox: outbox as never,
    context: rootEventContext(nextId),
  });
  return repo;
}

function capturedIntent(intentId: string, refundEventId: string): PaymentIntent {
  const intent = PaymentIntent.create(
    UniqueEntityId.from(intentId),
    "order-1",
    usd(1000),
    "stripe",
  );
  intent.capture(pspToken("tok"), "charge-1", new Date("2026-09-26T00:00:00.000Z"));
  intent.refund(usd(500), refundEventId, new Date("2026-09-26T00:01:00.000Z"));
  return intent;
}

describe("PrismaPaymentIntentRepository refund settlement — tenant isolation (G-76, closed)", () => {
  it("refuses rather than settling another tenant's refund when a refund id collides", async () => {
    const { client, refunds } = fakeTx();
    refunds.push({
      id: "refund-shared",
      tenantId: "tenant-a",
      intentId: "intent-a",
      amountMinor: 500,
      status: "completed",
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      idempotencyKey: null,
    });

    const repo = wireRepo();
    const intentB = capturedIntent("intent-b", "refund-shared");

    await expect(repo.save(intentB, "tenant-b", client)).rejects.toThrow(/unique constraint/i);

    const tenantARow = refunds.find((r) => r.id === "refund-shared" && r.tenantId === "tenant-a");
    expect(tenantARow?.status).toBe("completed");
    expect(refunds.filter((r) => r.id === "refund-shared")).toHaveLength(1);
  });

  it("creates and settles a refund it owns without touching any other row", async () => {
    const { client, refunds } = fakeTx();
    const repo = wireRepo();
    const intentA = capturedIntent("intent-a", "refund-a");

    await repo.save(intentA, "tenant-a", client);

    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ id: "refund-a", tenantId: "tenant-a", status: "completed" });
  });
});
