import { ValueObject } from "@platform/domain";

export type ReviewStatusValue = "pending" | "published" | "rejected" | "flagged" | "removed";

/** The validated lifecycle transition table (Sprint 5.2). */
const TRANSITIONS: Readonly<Record<ReviewStatusValue, readonly ReviewStatusValue[]>> = {
  pending: ["published", "rejected"],
  published: ["flagged", "removed"],
  rejected: [],
  flagged: ["published", "removed"],
  removed: [],
};

/** Whether a transition from `from` to `to` is allowed by the review lifecycle's transition table. */
export function canTransitionReview(from: ReviewStatusValue, to: ReviewStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ReviewStatusProps {
  readonly value: ReviewStatusValue;
}

/** The moderation lifecycle state of a review (pending→published→rejected/flagged→removed). */
export class ReviewStatus extends ValueObject<ReviewStatusProps> {
  static pending(): ReviewStatus {
    return new ReviewStatus({ value: "pending" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: ReviewStatusValue): ReviewStatus {
    return new ReviewStatus({ value });
  }

  get value(): ReviewStatusValue {
    return this.props.value;
  }
}
