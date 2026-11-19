import { describe, expect, it } from "vitest";
import type { Database } from "@platform/db";
import { rootEventContext } from "@platform/messaging";
import { PrismaPaymentIntentRepository } from "./prisma-payment-intent-repository";

const UUID = "0192f3a1-0000-7000-8000-000000000001";

/** A database whose tenant-scoped transaction records what `paymentIntent.findMany` was asked. */
function recordingDatabase() {
  const asked: unknown[] = [];
  const client = {
    $executeRaw: async () => 0,
    paymentIntent: {
      findMany: async (args: unknown) => {
        asked.push(args);
        return [];
      },
    },
  };
  const database = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  } as unknown as Database;
  return { database, asked };
}

const repository = (database: Database) =>
  new PrismaPaymentIntentRepository({
    prisma: database,
    outbox: { write: async () => undefined } as never,
    context: rootEventContext({ generate: () => "evt" }),
  });

describe("PrismaPaymentIntentRepository.findByIds (order operations Part 1)", () => {
  it("asks for this tenant's intents only, among the UUID-shaped ids, deduped", async () => {
    const { database, asked } = recordingDatabase();
    await repository(database).findByIds([UUID, "payment-legacy-1", UUID], "t-a");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ where: { tenantId: "t-a", id: { in: [UUID] } } });
  });

  it("does not query at all when no id can be an intent (a legacy non-UUID paymentRef)", async () => {
    const { database, asked } = recordingDatabase();
    expect(await repository(database).findByIds(["payment-legacy-1"], "t-a")).toEqual([]);
    expect(asked).toEqual([]);
  });
});
