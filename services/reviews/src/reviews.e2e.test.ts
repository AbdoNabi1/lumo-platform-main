import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireReviews } from "./composition";
import { InMemoryOrdersPort } from "./infrastructure/in-memory-port-adapters";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire(orders = new InMemoryOrdersPort()) {
  return wireReviews({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    orders,
  });
}

function createInput() {
  return { productRef: "product-1", customerRef: "customer-1", rating: 5, bodyText: "Great!" };
}

describe("reviews (end to end)", () => {
  it("runs the full lifecycle: create -> publish -> vote -> report x3 auto-flag, publishing canonical events", async () => {
    const orders = new InMemoryOrdersPort();
    orders.markPurchased("customer-1", "product-1");
    const app = wire(orders);

    const created = await app.reviews.create(createInput());
    expect(created.status).toBe(201);
    const id = (created.body as { reviewId: string }).reviewId;

    const published = await app.reviews.advance({ reviewId: id, toStatus: "published" });
    expect(published.status).toBe(200);

    await app.reviews.vote({ reviewId: id, customerRef: "voter-1", helpful: true });
    await app.reviews.report({ reviewId: id, reporterRef: "r-1" });
    await app.reviews.report({ reviewId: id, reporterRef: "r-2" });
    const third = await app.reviews.report({ reviewId: id, reporterRef: "r-3" });
    expect((third.body as { status: string }).status).toBe("flagged");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("reviews.review.published");
    expect(app.deliveredEventTypes).toContain("reviews.review.voted");
    expect(app.deliveredEventTypes).toContain("reviews.review.flagged");
  });

  it("moderation is replay-safe by actionId", async () => {
    const app = wire();
    const created = await app.reviews.create(createInput());
    const id = (created.body as { reviewId: string }).reviewId;

    const first = await app.reviews.moderate({
      reviewId: id,
      actionId: "action-1",
      action: "reject",
      moderatorRef: "moderator-1",
    });
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const replay = await app.reviews.moderate({
      reviewId: id,
      actionId: "action-1",
      action: "reject",
      moderatorRef: "moderator-1",
    });
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects a second review by the same customer for the same product (409)", async () => {
    const app = wire();
    await app.reviews.create(createInput());
    const response = await app.reviews.create(createInput());
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown review", async () => {
    const app = wire();
    const response = await app.reviews.advance({ reviewId: "missing", toStatus: "published" });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid rating (422)", async () => {
    const app = wire();
    const response = await app.reviews.create({ ...createInput(), rating: 10 });
    expect(response.status).toBe(422);
  });
});
