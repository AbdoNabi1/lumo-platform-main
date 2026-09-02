import { Entity, type UniqueEntityId } from "@platform/domain";

export type ReturnAttemptKind =
  "approval" | "rma" | "receive" | "inspection" | "accept" | "resolution" | "warehouse_callback";
export type ReturnAttemptOutcome = "succeeded" | "failed";

interface ReturnAttemptProps {
  readonly kind: ReturnAttemptKind;
  readonly outcome: ReturnAttemptOutcome;
  readonly reference?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for a lifecycle step attempt (retry-safe observability trail; never rewritten). */
export class ReturnAttempt extends Entity<ReturnAttemptProps> {
  static create(
    id: UniqueEntityId,
    kind: ReturnAttemptKind,
    outcome: ReturnAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): ReturnAttempt {
    return new ReturnAttempt({ kind, outcome, reference, occurredAt }, id);
  }

  get kind(): ReturnAttemptKind {
    return this.props.kind;
  }

  get outcome(): ReturnAttemptOutcome {
    return this.props.outcome;
  }

  get reference(): string | undefined {
    return this.props.reference;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
