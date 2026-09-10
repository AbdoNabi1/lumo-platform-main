import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Review } from "../domain/review";
import type { ReviewRepository } from "../domain/review-repository";

export interface GetReviewInput {
  readonly reviewId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface GetReviewDeps {
  readonly reviews: ReviewRepository;
}

/** Fetches a single review by id. */
export class GetReview implements UseCase<GetReviewInput, Review, DomainError> {
  private readonly deps: GetReviewDeps;

  constructor(deps: GetReviewDeps) {
    this.deps = deps;
  }

  async execute(input: GetReviewInput): Promise<Result<Review, DomainError>> {
    const review = await this.deps.reviews.findById(input.reviewId, input.tenantId);
    return review === null ? err(new NotFoundError("Review not found")) : ok(review);
  }
}
