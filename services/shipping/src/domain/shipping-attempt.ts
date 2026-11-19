import { Entity, type UniqueEntityId } from "@platform/domain";

export type ShippingAttemptKind = "label" | "carrier" | "retry" | "carrier_webhook";
/**
 * `pending` (local carriers, Ruling 4): a carrier label request that has started but whose result
 * is not yet known. It is settled append-only, by a later `label` attempt with the same reference.
 */
export type ShippingAttemptOutcome = "succeeded" | "failed" | "pending";

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
