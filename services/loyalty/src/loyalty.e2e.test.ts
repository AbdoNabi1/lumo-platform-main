import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLoyalty } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireLoyalty({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newAccountId(app: ReturnType<typeof wire>): Promise<string> {
  const opened = await app.loyalty.open({ customerRef: "customer-1", tenantId: "tenant-local" });
  expect(opened.status).toBe(201);
  return (opened.body as { accountId: string }).accountId;
}

describe("loyalty (end to end)", () => {
  it("runs the full lifecycle: open -> earn -> tier upgrade -> redeem, publishing canonical events", async () => {
    const app = wire();
    const id = await newAccountId(app);

    const earned = await app.loyalty.earn({
      accountId: id,
      idempotencyKey: "idem-1",
      points: 600,
      ref: "order-1",
      tenantId: "tenant-local",
    });
    expect(earned.status).toBe(200);
    expect((earned.body as { tierName: string }).tierName).toBe("silver");

    const redeemed = await app.loyalty.redeem({
      accountId: id,
      idempotencyKey: "idem-2",
      rewardRef: "reward-1",
      rewardName: "Free shipping",
      costPoints: 100,
      tenantId: "tenant-local",
    });
    expect(redeemed.status).toBe(200);
    expect((redeemed.body as { balance: number }).balance).toBe(500);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("loyalty.points.earned");
    expect(app.deliveredEventTypes).toContain("loyalty.tier.upgraded");
    expect(app.deliveredEventTypes).toContain("loyalty.reward.redeemed");
  });

  it("earning is idempotent by idempotencyKey", async () => {
    const app = wire();
    const id = await newAccountId(app);
    await app.loyalty.earn({
      accountId: id,
      idempotencyKey: "idem-shared",
      points: 50,
      ref: "order-1",
      tenantId: "tenant-local",
    });
    const replay = await app.loyalty.earn({
      accountId: id,
      idempotencyKey: "idem-shared",
      points: 50,
      ref: "order-1",
      tenantId: "tenant-local",
    });
    expect((replay.body as { balance: number }).balance).toBe(50);
  });

  it("rejects opening a second account for the same customer (409)", async () => {
    const app = wire();
    await newAccountId(app);
    const response = await app.loyalty.open({
      customerRef: "customer-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("rejects spending more points than the balance (409)", async () => {
    const app = wire();
    const id = await newAccountId(app);
    const response = await app.loyalty.spend({
      accountId: id,
      idempotencyKey: "idem-1",
      points: 10,
      ref: "reward-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown account", async () => {
    const app = wire();
    const response = await app.loyalty.earn({
      accountId: "missing",
      idempotencyKey: "idem-1",
      points: 10,
      ref: "order-1",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
