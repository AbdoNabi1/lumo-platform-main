import type { Database, TransactionClient } from "@platform/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaProcessedCarrierWebhookStore } from "./prisma-processed-carrier-webhook-store";

beforeEach(() => {
  expect.hasAssertions();
});

function fakeClient(overrides: { row?: unknown; createError?: unknown } = {}) {
  const findUnique = vi.fn().mockResolvedValue(overrides.row ?? null);
  const create =
    overrides.createError === undefined
      ? vi.fn().mockResolvedValue({})
      : vi.fn().mockRejectedValue(overrides.createError);
  return { client: { processedShippingWebhook: { findUnique, create } }, findUnique, create };
}

/** A root client whose `$transaction` runs the callback on the same fake (RLS `set_config` is a no-op here). */
function rootOf(fake: ReturnType<typeof fakeClient>): Database {
  const tx = { ...fake.client, $executeRaw: vi.fn().mockResolvedValue(1) };
  return {
    $transaction: (run: (client: unknown) => Promise<unknown>) => run(tx),
  } as unknown as Database;
}

describe("PrismaProcessedCarrierWebhookStore", () => {
  it("hasProcessed looks up the composite unique key", async () => {
    const fake = fakeClient({ row: { id: "x" } });
    const store = new PrismaProcessedCarrierWebhookStore(rootOf(fake));
    const tx = fake.client as unknown as TransactionClient;
    expect(await store.hasProcessed("bosta", "e", "t-1", tx)).toBe(true);
    expect(fake.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_carrier_webhookEventId: {
            tenantId: "t-1",
            carrier: "bosta",
            webhookEventId: "e",
          },
        },
      }),
    );
    const none = fakeClient();
    expect(
      await new PrismaProcessedCarrierWebhookStore(rootOf(none)).hasProcessed(
        "bosta",
        "e",
        "t-1",
        none.client,
      ),
    ).toBe(false);
  });

  it("markProcessed creates the row with tenant, carrier and event id", async () => {
    const fake = fakeClient();
    await new PrismaProcessedCarrierWebhookStore(rootOf(fake)).markProcessed(
      "bosta",
      "e",
      "t-1",
      fake.client,
    );
    expect(fake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t-1", carrier: "bosta", webhookEventId: "e" }),
    });
  });

  it("treats P2002 as already processed", async () => {
    const fake = fakeClient({ createError: { code: "P2002" } });
    await expect(
      new PrismaProcessedCarrierWebhookStore(rootOf(fake)).markProcessed(
        "bosta",
        "e",
        "t-1",
        fake.client,
      ),
    ).resolves.toBeUndefined();
  });

  it("rethrows any other error", async () => {
    const boom = new Error("db down");
    const fake = fakeClient({ createError: boom });
    await expect(
      new PrismaProcessedCarrierWebhookStore(rootOf(fake)).markProcessed(
        "bosta",
        "e",
        "t-1",
        fake.client,
      ),
    ).rejects.toBe(boom);
  });

  it("uses the given tx and never the root client", async () => {
    const root = fakeClient();
    const given = fakeClient();
    const store = new PrismaProcessedCarrierWebhookStore({
      ...rootOf(root),
      processedShippingWebhook: root.client.processedShippingWebhook,
    } as unknown as Database);
    await store.hasProcessed("bosta", "e", "t-1", given.client);
    await store.markProcessed("bosta", "e", "t-1", given.client);
    expect(given.findUnique).toHaveBeenCalledTimes(1);
    expect(given.create).toHaveBeenCalledTimes(1);
    expect(root.findUnique).not.toHaveBeenCalled();
    expect(root.create).not.toHaveBeenCalled();
  });
});
