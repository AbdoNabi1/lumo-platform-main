import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireReturns } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-12T00:00:00.000Z") };

function wire() {
  return wireReturns({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newReturnId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.returns.create({
    orderRef: "order-1",
    items: [
      {
        orderItemRef: "order-item-1",
        productRef: "product-1",
        quantity: 1,
        reasonCode: "defective",
      },
    ],
  });
  expect(created.status).toBe(201);
  return (created.body as { returnId: string }).returnId;
}

describe("returns (end to end)", () => {
  it("runs the full Sprint 4.11 RMA flow to refund, publishing canonical events", async () => {
    const app = wire();
    const id = await newReturnId(app);

    const decided = await app.returns.decision({ returnId: id, approved: true });
    expect(decided.status).toBe(200);
    expect((decided.body as { status: string }).status).toBe("approved");

    const rma = await app.returns.rma({ returnId: id, rmaNumber: "RMA-1" });
    expect(rma.status).toBe(200);
    expect((rma.body as { status: string }).status).toBe("rma_generated");

    const received = await app.returns.receive({
      returnId: id,
      source: "warehouse-1",
      callbackId: "cb-1",
    });
    expect(received.status).toBe(200);
    expect((received.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((received.body as { status: string }).status).toBe("package_received");

    const inspected = await app.returns.inspection({
      returnId: id,
      itemRef: "order-item-1",
      passed: true,
    });
    expect(inspected.status).toBe(200);

    const inspectionDone = await app.returns.advance({
      returnId: id,
      toStatus: "inspection_completed",
    });
    expect(inspectionDone.status).toBe(200);

    const accepted = await app.returns.accept({
      returnId: id,
      items: [{ orderItemRef: "order-item-1", disposition: "restock" }],
    });
    expect(accepted.status).toBe(200);
    expect((accepted.body as { status: string }).status).toBe("items_accepted");

    const resolved = await app.returns.resolution({
      returnId: id,
      outcome: "refund",
      amountMinor: 1999,
      currency: "USD",
    });
    expect(resolved.status).toBe(200);
    expect((resolved.body as { status: string }).status).toBe("refund_requested");

    const closed = await app.returns.advance({ returnId: id, toStatus: "closed" });
    expect(closed.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("returns.request.approved");
    expect(app.deliveredEventTypes).toContain("returns.package.rma_generated");
    expect(app.deliveredEventTypes).toContain("returns.package.received");
    expect(app.deliveredEventTypes).toContain("returns.items.accepted");
    expect(app.deliveredEventTypes).toContain("returns.refund.requested");
  });

  it("getByOrder resolves the return request opened for an order (Phase A.30 admin panel)", async () => {
    const app = wire();
    const id = await newReturnId(app);

    const found = await app.returns.getByOrder({ orderRef: "order-1" });
    expect(found.status).toBe(200);
    expect((found.body as { id: { toString(): string } }).id.toString()).toBe(id);

    const missing = await app.returns.getByOrder({ orderRef: "order-does-not-exist" });
    expect(missing.status).toBe(404);
  });

  it("inspection is idempotent by itemRef — a repeat call doesn't change the recorded result", async () => {
    const app = wire();
    const id = await newReturnId(app);
    await app.returns.decision({ returnId: id, approved: true });
    await app.returns.rma({ returnId: id, rmaNumber: "RMA-2" });
    await app.returns.receive({ returnId: id, source: "warehouse-1", callbackId: "cb-2" });

    const first = await app.returns.inspection({
      returnId: id,
      itemRef: "order-item-1",
      passed: true,
    });
    expect(first.status).toBe(200);
    const replay = await app.returns.inspection({
      returnId: id,
      itemRef: "order-item-1",
      passed: false,
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { status: string }).status).toBe("package_received");
  });

  it("warehouse-callback idempotency: first processed, replay deduped", async () => {
    const app = wire();
    const id = await newReturnId(app);
    await app.returns.decision({ returnId: id, approved: true });
    await app.returns.rma({ returnId: id, rmaNumber: "RMA-3" });

    const first = await app.returns.receive({
      returnId: id,
      source: "warehouse-1",
      callbackId: "cb-3",
    });
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const replay = await app.returns.receive({
      returnId: id,
      source: "warehouse-1",
      callbackId: "cb-3",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const id = await newReturnId(app);
    const response = await app.returns.advance({ returnId: id, toStatus: "rma_generated" });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown return request", async () => {
    const app = wire();
    const response = await app.returns.advance({ returnId: "missing", toStatus: "approved" });
    expect(response.status).toBe(404);
  });

  it("rejects an empty item list at creation (422)", async () => {
    const app = wire();
    const response = await app.returns.create({ orderRef: "order-1", items: [] });
    expect(response.status).toBe(422);
  });
});
