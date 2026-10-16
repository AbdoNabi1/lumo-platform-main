import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { Review } from "../domain/review";
import { Rating } from "../domain/value-objects/rating";
import { ReviewMedia } from "../domain/value-objects/review-media";
import { ReviewsEventTranslator } from "./reviews-event-translator";
import { InMemoryReviewRepository } from "./in-memory-review-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ReviewsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "reviews",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryReviewRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryReviewRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's review by id, customer+product, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const review = Review.create(
      UniqueEntityId.from(nextId()),
      "product-1",
      "customer-1",
      must(Rating.create(5)),
      "Great!",
      ReviewMedia.create([]),
      false,
    );
    await repository.save(review, "tenant-a");

    expect(await repository.findById(review.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(review.id.toString(), "tenant-b")).toBeNull();

    expect(
      await repository.findByCustomerAndProduct("customer-1", "product-1", "tenant-a"),
    ).not.toBeNull();
    expect(
      await repository.findByCustomerAndProduct("customer-1", "product-1", "tenant-b"),
    ).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((r) => r.id.toString())).toContain(review.id.toString());
    expect(pageB.items.map((r) => r.id.toString())).not.toContain(review.id.toString());

    const byProductA = await repository.findByProductRef("product-1", {}, "tenant-a");
    const byProductB = await repository.findByProductRef("product-1", {}, "tenant-b");
    expect(byProductA.items.map((r) => r.id.toString())).toContain(review.id.toString());
    expect(byProductB.items.map((r) => r.id.toString())).not.toContain(review.id.toString());
  });
});

describe("InMemoryReviewRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("reviews", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryReviewRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = Review.create(
        UniqueEntityId.from(nextId()),
        "product-1",
        "customer-1",
        must(Rating.create(5)),
        "Great!",
        ReviewMedia.create([]),
        false,
      );
      agg.publish(nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
