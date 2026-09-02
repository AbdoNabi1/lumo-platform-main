import { Entity, type UniqueEntityId } from "@platform/domain";

export type ReviewModerationAction = "reject" | "flag" | "restore" | "remove";

interface ReviewModerationProps {
  readonly actionId: string;
  readonly action: ReviewModerationAction;
  readonly moderatorRef: string;
  readonly reason?: string;
  readonly occurredAt: Date;
}

/** An append-only moderation-action audit log entry — replay-safety is enforced at the use-case layer via `ProcessedModerationStore` (keyed by `actionId`), not here. */
export class ReviewModeration extends Entity<ReviewModerationProps> {
  static create(
    id: UniqueEntityId,
    actionId: string,
    action: ReviewModerationAction,
    moderatorRef: string,
    occurredAt: Date,
    reason?: string,
  ): ReviewModeration {
    return new ReviewModeration({ actionId, action, moderatorRef, reason, occurredAt }, id);
  }

  get actionId(): string {
    return this.props.actionId;
  }

  get action(): ReviewModerationAction {
    return this.props.action;
  }

  get moderatorRef(): string {
    return this.props.moderatorRef;
  }

  get reason(): string | undefined {
    return this.props.reason;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
