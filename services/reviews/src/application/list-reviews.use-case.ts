import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Review } from "../domain/review";
import type { ReviewRepository } from "../domain/review-repository";
import type { ReviewStatusValue } from "../domain/value-objects/review-status";

export interface ListReviewsInput extends CursorPage {
  /** Filters to one status — this is what makes the same endpoint the moderation queue. */
  readonly status?: ReviewStatusValue;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListReviewsDeps {
  readonly reviews: ReviewRepository;
}

/** Cursor-paginated review listing, optionally filtered to a single status. */
export class ListReviews implements UseCase<ListReviewsInput, Paginated<Review>, DomainError> {
  private readonly deps: ListReviewsDeps;

  constructor(deps: ListReviewsDeps) {
    this.deps = deps;
  }

  async execute(input: ListReviewsInput): Promise<Result<Paginated<Review>, DomainError>> {
    const { status, tenantId, ...page } = input;
    return ok(
      await this.deps.reviews.list(page, tenantId, status !== undefined ? { status } : undefined),
    );
  }
}
