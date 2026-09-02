import { Entity, type UniqueEntityId } from "@platform/domain";

export type DeliveryAttemptOutcome = "succeeded" | "failed";

interface DeliveryAttemptProps {
  readonly channel: string;
  readonly outcome: DeliveryAttemptOutcome;
  readonly providerRef?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for one provider-level send attempt (retry-safe observability trail; never rewritten). */
export class DeliveryAttempt extends Entity<DeliveryAttemptProps> {
  static create(
    id: UniqueEntityId,
    channel: string,
    outcome: DeliveryAttemptOutcome,
    occurredAt: Date,
    providerRef?: string,
  ): DeliveryAttempt {
    return new DeliveryAttempt({ channel, outcome, providerRef, occurredAt }, id);
  }

  get channel(): string {
    return this.props.channel;
  }

  get outcome(): DeliveryAttemptOutcome {
    return this.props.outcome;
  }

  get providerRef(): string | undefined {
    return this.props.providerRef;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
