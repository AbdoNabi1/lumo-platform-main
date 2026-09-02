import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { DeliveryAttempt, type DeliveryAttemptOutcome } from "./delivery-attempt";
import { NotificationTransitioned } from "./events/notification-transitioned.event";
import { NotificationEvent } from "./notification-event";
import type { DeliveryPolicy } from "./value-objects/delivery-policy";
import type { NotificationChannel } from "./value-objects/notification-channel";
import {
  canTransitionNotification,
  NotificationStatus,
  type NotificationStatusValue,
} from "./value-objects/notification-status";
import type { NotificationTemplate } from "./value-objects/notification-template";
import type { RenderedContent } from "./value-objects/rendered-content";
import type { Recipient } from "./value-objects/recipient";

interface NotificationProps {
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipient: Recipient;
  readonly channels: NotificationChannel[];
  channelIndex: number;
  readonly template: NotificationTemplate;
  readonly variables: Readonly<Record<string, string>>;
  readonly policy: DeliveryPolicy;
  status: NotificationStatus;
  readonly attempts: DeliveryAttempt[];
  readonly history: NotificationEvent[];
  deliveredAt?: Date;
}

/**
 * Source of truth for the delivery lifecycle, delivery attempts/history, retry policy, template
 * rendering, and channel routing (Sprint 4.12). Full lifecycle: `created` → `queued` → `sent` →
 * `delivered`; `failed` → `retrying`/`dead_letter`/`expired`. Never sends email/SMS/push or calls
 * any external provider itself — every external channel leaves only through an outbound provider
 * port driven by the application layer; `in_app` is delivered internally. No contact PII —
 * `recipient` is a bare reference only (ADR-0006).
 */
export class Notification extends AggregateRoot<NotificationProps> {
  static create(
    id: UniqueEntityId,
    idempotencyKey: string,
    sourceRef: string,
    recipient: Recipient,
    channels: readonly NotificationChannel[],
    template: NotificationTemplate,
    variables: Readonly<Record<string, string>>,
    policy: DeliveryPolicy,
  ): Notification {
    return new Notification(
      {
        idempotencyKey,
        sourceRef,
        recipient,
        channels: [...channels],
        channelIndex: 0,
        template,
        variables,
        policy,
        status: NotificationStatus.created(),
        attempts: [],
        history: [],
      },
      id,
    );
  }

  /**
   * Rebuilds a persisted notification exactly as stored - no domain events raised, persisted
   * `version` carried for optimistic locking (ADR-0003, G-12).
   */
  static reconstitute(
    id: UniqueEntityId,
    idempotencyKey: string,
    sourceRef: string,
    recipient: Recipient,
    channels: readonly NotificationChannel[],
    channelIndex: number,
    template: NotificationTemplate,
    variables: Readonly<Record<string, string>>,
    policy: DeliveryPolicy,
    status: NotificationStatus,
    version: number,
    extra: {
      readonly attempts?: readonly DeliveryAttempt[];
      readonly history?: readonly NotificationEvent[];
      readonly deliveredAt?: Date;
    } = {},
  ): Notification {
    return new Notification(
      {
        idempotencyKey,
        sourceRef,
        recipient,
        channels: [...channels],
        channelIndex,
        template,
        variables,
        policy,
        status,
        attempts: extra.attempts === undefined ? [] : [...extra.attempts],
        history: extra.history === undefined ? [] : [...extra.history],
        deliveredAt: extra.deliveredAt,
      },
      id,
      version,
    );
  }

  /** The generic, validated transition — every named method below delegates to this. */
  transition(toStatus: NotificationStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionNotification(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition notification from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = NotificationStatus.from(toStatus);
    this.props.history.push(
      NotificationEvent.create(
        UniqueEntityId.from(this.id.toString() + this.props.history.length),
        toStatus,
        occurredAt,
      ),
    );
    this.addDomainEvent(
      new NotificationTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        { sourceRef: this.props.sourceRef, fromStatus, toStatus },
      ),
    );
  }

  queue(eventId: string, occurredAt: Date): void {
    this.transition("queued", eventId, occurredAt);
  }

  /** Records a successful provider send and transitions to `sent`. */
  markSent(providerRef: string, eventId: string, occurredAt: Date): void {
    this.transition("sent", eventId, occurredAt);
    this.recordAttempt("succeeded", occurredAt, providerRef);
  }

  markFailed(reason: string, eventId: string, occurredAt: Date): void {
    this.transition("failed", eventId, occurredAt);
    this.recordAttempt("failed", occurredAt, reason);
  }

  /** Marks delivery complete — records `deliveredAt`. */
  markDelivered(eventId: string, occurredAt: Date): void {
    this.transition("delivered", eventId, occurredAt);
    this.props.deliveredAt = occurredAt;
  }

  /**
   * Retries a failed notification per the delivery policy: expires if past `expiresAt`, moves to
   * `dead_letter` if attempts are exhausted, otherwise advances to the next fallback channel (if
   * any) and transitions to `retrying`.
   */
  retry(eventId: string, occurredAt: Date): void {
    if (this.props.policy.isExpiredAt(occurredAt)) {
      this.transition("expired", eventId, occurredAt);
      return;
    }
    const failedAttempts = this.props.attempts.filter((a) => a.outcome === "failed").length;
    if (this.props.policy.isExhausted(failedAttempts)) {
      this.transition("dead_letter", eventId, occurredAt);
      return;
    }
    if (this.props.channelIndex < this.props.channels.length - 1) {
      this.props.channelIndex += 1;
    }
    this.transition("retrying", eventId, occurredAt);
  }

  cancel(eventId: string, occurredAt: Date): void {
    this.transition("cancelled", eventId, occurredAt);
  }

  expire(eventId: string, occurredAt: Date): void {
    this.transition("expired", eventId, occurredAt);
  }

  /** Renders this notification's own content using its stored template + variables — pure, no side effects. */
  render(): RenderedContent {
    return this.props.template.render(this.props.variables);
  }

  private recordAttempt(
    outcome: DeliveryAttemptOutcome,
    occurredAt: Date,
    providerRef?: string,
  ): void {
    this.props.attempts.push(
      DeliveryAttempt.create(
        UniqueEntityId.from(this.id.toString() + this.props.attempts.length),
        this.currentChannel.value,
        outcome,
        occurredAt,
        providerRef,
      ),
    );
  }

  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  get sourceRef(): string {
    return this.props.sourceRef;
  }

  get recipient(): Recipient {
    return this.props.recipient;
  }

  get channels(): readonly NotificationChannel[] {
    return this.props.channels;
  }

  get channelIndex(): number {
    return this.props.channelIndex;
  }

  get currentChannel(): NotificationChannel {
    const channel = this.props.channels[this.props.channelIndex];
    if (channel === undefined) {
      throw new BusinessRuleError("Notification has no channel at the current channel index");
    }
    return channel;
  }

  get template(): NotificationTemplate {
    return this.props.template;
  }

  get variables(): Readonly<Record<string, string>> {
    return this.props.variables;
  }

  get policy(): DeliveryPolicy {
    return this.props.policy;
  }

  get status(): NotificationStatus {
    return this.props.status;
  }

  /** The append-only provider-attempt log (persisted verbatim). */
  get attempts(): readonly DeliveryAttempt[] {
    return this.props.attempts;
  }

  /** The append-only lifecycle-status history (persisted verbatim). */
  get history(): readonly NotificationEvent[] {
    return this.props.history;
  }

  get deliveredAt(): Date | undefined {
    return this.props.deliveredAt;
  }
}
