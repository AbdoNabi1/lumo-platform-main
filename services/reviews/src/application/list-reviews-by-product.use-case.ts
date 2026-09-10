import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Review } from "../domain/review";
import type { ReviewRepository } from "../domain/review-repository";

export interface ListReviewsByProductInput extends CursorPage {
  readonly productRef: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListReviewsByProductDeps {
  readonly reviews: ReviewRepository;
}

/** Cursor-paginated reviews for one product — the customer-facing product page's read. */
export class ListReviewsByProduct implements UseCase<
  ListReviewsByProductInput,
  Paginated<Review>,
  DomainError
> {
  private readonly deps: ListReviewsByProductDeps;

  constructor(deps: ListReviewsByProductDeps) {
    this.deps = deps;
  }

  async execute(input: ListReviewsByProductInput): Promise<Result<Paginated<Review>, DomainError>> {
    const { productRef, tenantId, ...page } = input;
    return ok(await this.deps.reviews.findByProductRef(productRef, page, tenantId));
  }
}
