import { Entity, type UniqueEntityId } from "@platform/domain";

interface ReviewVoteProps {
  readonly customerRef: string;
  helpful: boolean;
  occurredAt: Date;
}

/** A helpful/unhelpful vote — one per customer (idempotent: a later vote replaces the earlier one). */
export class ReviewVote extends Entity<ReviewVoteProps> {
  static create(
    id: UniqueEntityId,
    customerRef: string,
    helpful: boolean,
    occurredAt: Date,
  ): ReviewVote {
    return new ReviewVote({ customerRef, helpful, occurredAt }, id);
  }

  replace(helpful: boolean, occurredAt: Date): void {
    this.props.helpful = helpful;
    this.props.occurredAt = occurredAt;
  }

  get customerRef(): string {
    return this.props.customerRef;
  }

  get helpful(): boolean {
    return this.props.helpful;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
