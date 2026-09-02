import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { CreateReview } from "./review.use-cases";
import { GetReview } from "./get-review.use-case";
import { ListReviewsByProduct } from "./list-reviews-by-product.use-case";
import { ListReviews } from "./list-reviews.use-case";
import { InMemoryOrdersPort } from "../infrastructure/in-memory-port-adapters";
import { InMemoryReviewRepository } from "../infrastructure/in-memory-review-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ReviewsEventTranslator } from "../infrastructure/reviews-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ReviewsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "reviews",
  });
  const context = rootEventContext(sequentialIds());
  const reviews = new InMemoryReviewRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  const orders = new InMemoryOrdersPort();
  return { reviews, unitOfWork, idGenerator, clock, orders };
}

describe("Reviews read use-cases (Phase 4 T4.1)", () => {
  it("ListReviews paginates and filters by status", async () => {
    const h = harness();
    const create = new CreateReview(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({
        productRef: `product-${i}`,
        customerRef: `customer-${i}`,
        rating: 5,
        bodyText: "Great!",
      });
    }

    const page = await new ListReviews(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);
    expect(page.value.pageInfo.endCursor).not.toBeNull();

    const rest = await new ListReviews(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);

    // every created review defaults to "pending" — the moderation queue filter
    const pending = await new ListReviews(h).execute({ status: "pending" });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value.items).toHaveLength(3);

    const published = await new ListReviews(h).execute({ status: "published" });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.items).toHaveLength(0);
  });

  it("GetReview returns the review, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateReview(h).execute({
      productRef: "product-1",
      customerRef: "customer-1",
      rating: 4,
      bodyText: "Pretty good",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetReview(h).execute({ reviewId: created.value.reviewId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.reviewId);

    const missing = await new GetReview(h).execute({ reviewId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListReviewsByProduct only returns reviews for the given product", async () => {
    const h = harness();
    const create = new CreateReview(h);
    await create.execute({
      productRef: "product-a",
      customerRef: "customer-1",
      rating: 5,
      bodyText: "Loved it",
    });
    await create.execute({
      productRef: "product-b",
      customerRef: "customer-1",
      rating: 3,
      bodyText: "It was fine",
    });

    const page = await new ListReviewsByProduct(h).execute({ productRef: "product-a" });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(1);
    expect(page.value.items[0]?.productRef).toBe("product-a");
  });
});
