import { Entity, type UniqueEntityId } from "@platform/domain";

export type ShippingAttemptKind = "label" | "carrier" | "retry" | "carrier_webhook";
export type ShippingAttemptOutcome = "succeeded" | "failed";

interface ShippingAttemptProps {
  readonly kind: ShippingAttemptKind;
  readonly outcome: ShippingAttemptOutcome;
  readonly reference?: string;
  readonly occurredAt: Date;
}

/** An append-only log entry for a lifecycle step attempt (retry-safe observability trail; never rewritten). */
export class ShippingAttempt extends Entity<ShippingAttemptProps> {
  static create(
    id: UniqueEntityId,
    kind: ShippingAttemptKind,
    outcome: ShippingAttemptOutcome,
    occurredAt: Date,
    reference?: string,
  ): ShippingAttempt {
    return new ShippingAttempt({ kind, outcome, reference, occurredAt }, id);
  }

  get kind(): ShippingAttemptKind {
    return this.props.kind;
  }

  get outcome(): ShippingAttemptOutcome {
    return this.props.outcome;
  }

  get reference(): string | undefined {
    return this.props.reference;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
