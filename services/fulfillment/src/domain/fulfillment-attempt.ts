import { Entity, type UniqueEntityId } from "@platform/domain";

export type FulfillmentAttemptKind = "transition" | "reservation" | "shipment" | "carrier_webhook";
export type FulfillmentAttemptOutcome = "succeeded" | "failed";

interface FulfillmentAttemptProps {
  readonly kind: FulfillmentAttemptKind;
  readonly outcome: FulfillmentAttemptOutcome;
  readonly reference?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for a lifecycle step attempt (retry-safe observability trail; never rewritten). */
export class FulfillmentAttempt extends Entity<FulfillmentAttemptProps> {
  static create(
    id: UniqueEntityId,
    kind: FulfillmentAttemptKind,
    outcome: FulfillmentAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): FulfillmentAttempt {
    return new FulfillmentAttempt({ kind, outcome, reference, occurredAt }, id);
  }

  get kind(): FulfillmentAttemptKind {
    return this.props.kind;
  }

  get outcome(): FulfillmentAttemptOutcome {
    return this.props.outcome;
  }

  get reference(): string | undefined {
    return this.props.reference;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
