import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Review } from "./review";
import { Rating } from "./value-objects/rating";
import { ReviewMedia } from "./value-objects/review-media";

function rating(value = 5): Rating {
  const result = Rating.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function review(): Review {
  return Review.create(
    UniqueEntityId.from("review-1"),
    "product-1",
    "customer-1",
    rating(),
    "Great product!",
    ReviewMedia.empty(),
    true,
  );
}

describe("Review", () => {
  it("starts pending", () => {
    const r = review();
    expect(r.status.value).toBe("pending");
    expect(r.pullDomainEvents()).toHaveLength(0);
  });

  it("publishes and raises a review.transitioned event", () => {
    const r = review();
    r.publish("evt-1", new Date(0));
    expect(r.status.value).toBe("published");
    const events = r.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("review.transitioned");
  });

  it("records a vote and replaces it on a second vote by the same customer", () => {
    const r = review();
    r.publish("evt-1", new Date(0));
    r.vote("voter-1", true, "evt-2", new Date(0));
    expect(r.helpfulCount).toBe(1);
    r.vote("voter-1", false, "evt-3", new Date(0));
    expect(r.helpfulCount).toBe(0);
    expect(r.unhelpfulCount).toBe(1);
  });

  it("auto-flags once the report threshold is reached", () => {
    const r = review();
    r.publish("evt-1", new Date(0));
    r.report("reporter-1", "evt-2", new Date(0));
    r.report("reporter-2", "evt-3", new Date(0));
    expect(r.status.value).toBe("published");
    r.report("reporter-3", "evt-4", new Date(0));
    expect(r.status.value).toBe("flagged");
  });

  it("records a merchant response", () => {
    const r = review();
    r.respond("Thanks for the feedback!", "evt-1", new Date(0));
    expect(r.merchantResponse).toBe("Thanks for the feedback!");
  });

  it("moderator action transitions status and logs to the moderation ledger", () => {
    const r = review();
    r.moderate("action-1", "reject", "moderator-1", "evt-1", new Date(0), "spam");
    expect(r.status.value).toBe("rejected");
    expect(r.moderations).toHaveLength(1);
  });

  it("rejects an illegal transition (rejected -> published, 409)", () => {
    const r = review();
    r.reject("evt-1", new Date(0));
    expect(() => r.transition("published", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
