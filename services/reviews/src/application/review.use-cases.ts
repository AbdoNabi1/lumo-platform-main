import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Review } from "../domain/review";
import type { ReviewModerationAction } from "../domain/review-moderation";
import type { ReviewRepository } from "../domain/review-repository";
import { Rating } from "../domain/value-objects/rating";
import { ReviewMedia } from "../domain/value-objects/review-media";
import type { ReviewStatusValue } from "../domain/value-objects/review-status";
import type { OrdersPort, ProcessedModerationStore } from "./ports";

export interface CreateReviewInput {
  readonly productRef: string;
  readonly customerRef: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs?: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ReviewStatusOutput {
  readonly reviewId: string;
  readonly status: string;
}

export interface ReviewIdInput {
  readonly reviewId: string;
  /** ADR-0014: the caller's verified tenant. Shared by every input extending this one. */
  readonly tenantId: string;
}

export interface ReviewDeps {
  readonly reviews: ReviewRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateReviewDeps extends ReviewDeps {
  readonly orders: OrdersPort;
}

/** Creates a review — one per `(customerRef, productRef)`. Verified-purchase is decided by `OrdersPort`. */
export class CreateReview implements UseCase<CreateReviewInput, ReviewStatusOutput, DomainError> {
  private readonly deps: CreateReviewDeps;

  constructor(deps: CreateReviewDeps) {
    this.deps = deps;
  }

  async execute(input: CreateReviewInput): Promise<Result<ReviewStatusOutput, DomainError>> {
    const bodyText = Guard.againstEmpty(input.bodyText, "bodyText");
    if (!bodyText.ok) return err(bodyText.error);
    const rating = Rating.create(input.rating);
    if (!rating.ok) return err(rating.error);

    return this.deps.unitOfWork.run<Result<ReviewStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.reviews.findByCustomerAndProduct(
        input.customerRef,
        input.productRef,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(new ConflictError("This customer has already reviewed this product"));
      }
      const verifiedPurchase = await this.deps.orders.hasPurchased(
        input.customerRef,
        input.productRef,
      );
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const review = Review.create(
        id,
        input.productRef,
        input.customerRef,
        rating.value,
        input.bodyText,
        ReviewMedia.create(input.assetRefs ?? []),
        verifiedPurchase,
      );
      await this.deps.reviews.save(review, input.tenantId, tx);
      return ok({ reviewId: id.toString(), status: review.status.value });
    });
  }
}

export interface AdvanceReviewInput extends ReviewIdInput {
  readonly toStatus: ReviewStatusValue;
}

/** Generic validated transition — used for publish/reject/flag/remove. */
export class AdvanceReview implements UseCase<AdvanceReviewInput, ReviewStatusOutput, DomainError> {
  private readonly deps: ReviewDeps;

  constructor(deps: ReviewDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceReviewInput): Promise<Result<ReviewStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReviewStatusOutput, DomainError>>(async (tx) => {
      const review = await this.deps.reviews.findById(input.reviewId, input.tenantId, tx);
      if (review === null) return err(new NotFoundError("Review not found"));

      try {
        review.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.reviews.save(review, input.tenantId, tx);
      return ok({ reviewId: review.id.toString(), status: review.status.value });
    });
  }
}

export interface VoteReviewInput extends ReviewIdInput {
  readonly customerRef: string;
  readonly helpful: boolean;
}

/** Records (or replaces) a helpful/unhelpful vote — idempotent per customer. */
export class VoteReview implements UseCase<VoteReviewInput, ReviewStatusOutput, DomainError> {
  private readonly deps: ReviewDeps;

  constructor(deps: ReviewDeps) {
    this.deps = deps;
  }

  async execute(input: VoteReviewInput): Promise<Result<ReviewStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReviewStatusOutput, DomainError>>(async (tx) => {
      const review = await this.deps.reviews.findById(input.reviewId, input.tenantId, tx);
      if (review === null) return err(new NotFoundError("Review not found"));

      review.vote(
        input.customerRef,
        input.helpful,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.reviews.save(review, input.tenantId, tx);
      return ok({ reviewId: review.id.toString(), status: review.status.value });
    });
  }
}

export interface ReportReviewInput extends ReviewIdInput {
  readonly reporterRef: string;
}

/** Records an abuse report — auto-flags once the threshold is reached. */
export class ReportReview implements UseCase<ReportReviewInput, ReviewStatusOutput, DomainError> {
  private readonly deps: ReviewDeps;

  constructor(deps: ReviewDeps) {
    this.deps = deps;
  }

  async execute(input: ReportReviewInput): Promise<Result<ReviewStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReviewStatusOutput, DomainError>>(async (tx) => {
      const review = await this.deps.reviews.findById(input.reviewId, input.tenantId, tx);
      if (review === null) return err(new NotFoundError("Review not found"));

      review.report(input.reporterRef, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.reviews.save(review, input.tenantId, tx);
      return ok({ reviewId: review.id.toString(), status: review.status.value });
    });
  }
}

export interface RespondToReviewInput extends ReviewIdInput {
  readonly responseText: string;
}

/** Records the merchant's response to a review. */
export class RespondToReview implements UseCase<
  RespondToReviewInput,
  ReviewStatusOutput,
  DomainError
> {
  private readonly deps: ReviewDeps;

  constructor(deps: ReviewDeps) {
    this.deps = deps;
  }

  async execute(input: RespondToReviewInput): Promise<Result<ReviewStatusOutput, DomainError>> {
    const responseText = Guard.againstEmpty(input.responseText, "responseText");
    if (!responseText.ok) return err(responseText.error);

    return this.deps.unitOfWork.run<Result<ReviewStatusOutput, DomainError>>(async (tx) => {
      const review = await this.deps.reviews.findById(input.reviewId, input.tenantId, tx);
      if (review === null) return err(new NotFoundError("Review not found"));

      review.respond(input.responseText, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.reviews.save(review, input.tenantId, tx);
      return ok({ reviewId: review.id.toString(), status: review.status.value });
    });
  }
}

export interface ModerateReviewInput extends ReviewIdInput {
  readonly actionId: string;
  readonly action: ReviewModerationAction;
  readonly moderatorRef: string;
  readonly reason?: string;
}

export interface ModerateReviewOutput extends ReviewStatusOutput {
  readonly duplicate: boolean;
}

export interface ModerateReviewDeps extends ReviewDeps {
  readonly processedModerations: ProcessedModerationStore;
}

/** Applies a moderator action — replay-safe by `actionId` via `ProcessedModerationStore`. */
export class ModerateReview implements UseCase<
  ModerateReviewInput,
  ModerateReviewOutput,
  DomainError
> {
  private readonly deps: ModerateReviewDeps;

  constructor(deps: ModerateReviewDeps) {
    this.deps = deps;
  }

  async execute(input: ModerateReviewInput): Promise<Result<ModerateReviewOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ModerateReviewOutput, DomainError>>(async (tx) => {
      const review = await this.deps.reviews.findById(input.reviewId, input.tenantId, tx);
      if (review === null) return err(new NotFoundError("Review not found"));

      const alreadyProcessed = await this.deps.processedModerations.hasProcessed(input.actionId);
      if (alreadyProcessed) {
        return ok({ reviewId: review.id.toString(), status: review.status.value, duplicate: true });
      }

      try {
        review.moderate(
          input.actionId,
          input.action,
          input.moderatorRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
          input.reason,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.reviews.save(review, input.tenantId, tx);
      await this.deps.processedModerations.markProcessed(input.actionId);
      return ok({ reviewId: review.id.toString(), status: review.status.value, duplicate: false });
    });
  }
}
