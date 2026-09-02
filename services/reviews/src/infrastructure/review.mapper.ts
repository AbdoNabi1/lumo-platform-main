import { UniqueEntityId } from "@platform/domain";
import { Review } from "../domain/review";
import { ReviewModeration, type ReviewModerationAction } from "../domain/review-moderation";
import { ReviewVote } from "../domain/review-vote";
import { Rating } from "../domain/value-objects/rating";
import { ReviewMedia } from "../domain/value-objects/review-media";
import { ReviewStatus, type ReviewStatusValue } from "../domain/value-objects/review-status";

export interface ReviewVoteJson {
  readonly id: string;
  readonly customerRef: string;
  readonly helpful: boolean;
  readonly occurredAt: string;
}

export interface ReviewModerationJson {
  readonly id: string;
  readonly actionId: string;
  readonly action: ReviewModerationAction;
  readonly moderatorRef: string;
  readonly reason?: string;
  readonly occurredAt: string;
}

export interface ReviewRow {
  readonly id: string;
  readonly productRef: string;
  readonly customerRef: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs: readonly string[];
  readonly verifiedPurchase: boolean;
  readonly status: string;
  readonly votes: readonly ReviewVoteJson[];
  readonly moderations: readonly ReviewModerationJson[];
  readonly reportCount: number;
  readonly merchantResponse: string | null;
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link Review}. Mapping only — no I/O. */
export class ReviewMapper {
  static toDomain(row: ReviewRow): Review {
    const rating = Rating.create(row.rating);
    if (!rating.ok) throw new Error(`Corrupt review row: invalid rating (${rating.error.message})`);

    return Review.reconstitute(
      UniqueEntityId.from(row.id),
      row.productRef,
      row.customerRef,
      rating.value,
      row.bodyText,
      ReviewMedia.create(row.assetRefs),
      row.verifiedPurchase,
      ReviewStatus.from(row.status as ReviewStatusValue),
      row.version,
      {
        votes: row.votes.map((v) =>
          ReviewVote.create(
            UniqueEntityId.from(v.id),
            v.customerRef,
            v.helpful,
            new Date(v.occurredAt),
          ),
        ),
        moderations: row.moderations.map((m) =>
          ReviewModeration.create(
            UniqueEntityId.from(m.id),
            m.actionId,
            m.action,
            m.moderatorRef,
            new Date(m.occurredAt),
            m.reason,
          ),
        ),
        reportCount: row.reportCount,
        merchantResponse: row.merchantResponse ?? undefined,
      },
    );
  }

  static toRow(review: Review, tenantId: string) {
    return {
      id: review.id.toString(),
      tenantId,
      productRef: review.productRef,
      customerRef: review.customerRef,
      rating: review.rating.value,
      bodyText: review.bodyText,
      assetRefs: review.media.assetRefs,
      verifiedPurchase: review.verifiedPurchase,
      status: review.status.value,
      votes: review.votes.map((v) => ({
        id: v.id.toString(),
        customerRef: v.customerRef,
        helpful: v.helpful,
        occurredAt: v.occurredAt.toISOString(),
      })),
      moderations: review.moderations.map((m) => ({
        id: m.id.toString(),
        actionId: m.actionId,
        action: m.action,
        moderatorRef: m.moderatorRef,
        reason: m.reason,
        occurredAt: m.occurredAt.toISOString(),
      })),
      reportCount: review.reportCount,
      merchantResponse: review.merchantResponse ?? null,
      version: 1,
    };
  }
}
