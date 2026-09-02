import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ReviewTransitioned } from "./events/review-transitioned.event";
import { ReviewModeration, type ReviewModerationAction } from "./review-moderation";
import { ReviewVote } from "./review-vote";
import type { Rating } from "./value-objects/rating";
import type { ReviewMedia } from "./value-objects/review-media";
import {
  canTransitionReview,
  ReviewStatus,
  type ReviewStatusValue,
} from "./value-objects/review-status";

const AUTO_FLAG_REPORT_THRESHOLD = 3;

interface ReviewProps {
  readonly productRef: string;
  readonly customerRef: string;
  readonly rating: Rating;
  readonly bodyText: string;
  readonly media: ReviewMedia;
  readonly verifiedPurchase: boolean;
  status: ReviewStatus;
  readonly votes: ReviewVote[];
  readonly moderations: ReviewModeration[];
  reportCount: number;
  merchantResponse?: string;
}

/**
 * Source of truth for one customer's review of a product (Sprint 5.2). Never modifies products
 * (product/customer refs only, no write port to Catalog). The verified-purchase flag is decided by
 * `OrdersPort.hasPurchased` at creation time — Reviews never decides this itself.
 */
export class Review extends AggregateRoot<ReviewProps> {
  static create(
    id: UniqueEntityId,
    productRef: string,
    customerRef: string,
    rating: Rating,
    bodyText: string,
    media: ReviewMedia,
    verifiedPurchase: boolean,
  ): Review {
    return new Review(
      {
        productRef,
        customerRef,
        rating,
        bodyText,
        media,
        verifiedPurchase,
        status: ReviewStatus.pending(),
        votes: [],
        moderations: [],
        reportCount: 0,
      },
      id,
    );
  }

  /** Rebuilds a persisted review exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    productRef: string,
    customerRef: string,
    rating: Rating,
    bodyText: string,
    media: ReviewMedia,
    verifiedPurchase: boolean,
    status: ReviewStatus,
    version: number,
    extra: {
      readonly votes?: readonly ReviewVote[];
      readonly moderations?: readonly ReviewModeration[];
      readonly reportCount?: number;
      readonly merchantResponse?: string;
    } = {},
  ): Review {
    return new Review(
      {
        productRef,
        customerRef,
        rating,
        bodyText,
        media,
        verifiedPurchase,
        status,
        votes: extra.votes === undefined ? [] : [...extra.votes],
        moderations: extra.moderations === undefined ? [] : [...extra.moderations],
        reportCount: extra.reportCount ?? 0,
        merchantResponse: extra.merchantResponse,
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every named method below delegates to this. */
  transition(toStatus: ReviewStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionReview(fromStatus, toStatus)) {
      throw new BusinessRuleError(`Cannot transition review from "${fromStatus}" to "${toStatus}"`);
    }
    this.props.status = ReviewStatus.from(toStatus);
    this.raise(toStatus, eventId, occurredAt);
  }

  publish(eventId: string, occurredAt: Date): void {
    this.transition("published", eventId, occurredAt);
  }

  reject(eventId: string, occurredAt: Date): void {
    this.transition("rejected", eventId, occurredAt);
  }

  flag(eventId: string, occurredAt: Date): void {
    this.transition("flagged", eventId, occurredAt);
  }

  remove(eventId: string, occurredAt: Date): void {
    this.transition("removed", eventId, occurredAt);
  }

  /** Records (or replaces) a helpful/unhelpful vote — idempotent per customer. */
  vote(customerRef: string, helpful: boolean, eventId: string, occurredAt: Date): void {
    const existing = this.props.votes.find((v) => v.customerRef === customerRef);
    if (existing !== undefined) {
      existing.replace(helpful, occurredAt);
    } else {
      this.props.votes.push(
        ReviewVote.create(
          UniqueEntityId.from(this.id.toString() + this.props.votes.length),
          customerRef,
          helpful,
          occurredAt,
        ),
      );
    }
    this.raise("voted", eventId, occurredAt, customerRef);
  }

  /** Records an abuse report — auto-flags once the report threshold is reached. */
  report(reporterRef: string, eventId: string, occurredAt: Date): void {
    this.props.reportCount += 1;
    this.raise("reported", eventId, occurredAt, reporterRef);
    if (
      this.props.reportCount >= AUTO_FLAG_REPORT_THRESHOLD &&
      this.props.status.value === "published"
    ) {
      this.flag(eventId, occurredAt);
    }
  }

  /** Records the merchant's response to this review. */
  respond(responseText: string, eventId: string, occurredAt: Date): void {
    this.props.merchantResponse = responseText;
    this.raise("responded", eventId, occurredAt);
  }

  /**
   * Applies a moderator action, appending to the append-only moderation log. Replay-safety for the
   * same `actionId` is enforced by the application layer's `ProcessedModerationStore` check before
   * this is called — this method does not itself check for duplicates.
   */
  moderate(
    actionId: string,
    action: ReviewModerationAction,
    moderatorRef: string,
    eventId: string,
    occurredAt: Date,
    reason?: string,
  ): void {
    this.props.moderations.push(
      ReviewModeration.create(
        UniqueEntityId.from(this.id.toString() + this.props.moderations.length),
        actionId,
        action,
        moderatorRef,
        occurredAt,
        reason,
      ),
    );
    const toStatus: ReviewStatusValue =
      action === "reject"
        ? "rejected"
        : action === "flag"
          ? "flagged"
          : action === "remove"
            ? "removed"
            : "published";
    this.transition(toStatus, eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date, ref?: string): void {
    this.addDomainEvent(
      new ReviewTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          productRef: this.props.productRef,
          customerRef: this.props.customerRef,
          action,
          ref,
        },
      ),
    );
  }

  get productRef(): string {
    return this.props.productRef;
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get rating(): Rating {
    return this.props.rating;
  }

  get bodyText(): string {
    return this.props.bodyText;
  }

  get media(): ReviewMedia {
    return this.props.media;
  }

  get verifiedPurchase(): boolean {
    return this.props.verifiedPurchase;
  }

  get status(): ReviewStatus {
    return this.props.status;
  }

  get votes(): readonly ReviewVote[] {
    return this.props.votes;
  }

  get moderations(): readonly ReviewModeration[] {
    return this.props.moderations;
  }

  get reportCount(): number {
    return this.props.reportCount;
  }

  get merchantResponse(): string | undefined {
    return this.props.merchantResponse;
  }

  get helpfulCount(): number {
    return this.props.votes.filter((v) => v.helpful).length;
  }

  get unhelpfulCount(): number {
    return this.props.votes.filter((v) => !v.helpful).length;
  }
}
