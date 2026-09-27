import { readEnvelopeTenant, type IntegrationEvent } from "@platform/domain-events";
import type { MessagingMetrics, SupervisedConsumer } from "@platform/kafka";
import { KafkaMessageProducer } from "@platform/kafka";
import { OutboxWriter, rootEventContext, type EventHandler } from "@platform/messaging";
import {
  CreateNotification,
  NotificationsEventTranslator,
  PrismaNotificationRepository,
} from "@platform/notifications";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import type { Logger } from "@platform/utils";
import type { RuntimeCore } from "../composition";
import { buildProcessedConsumer } from "../security/consumer-runtime";

/**
 * The `licensing.subscription.<action>` wire payload — a structural mirror of `LicensingChangedData`
 * (`services/licensing/src/domain/events/licensing-changed.event.ts`), restated here rather than
 * imported for the same reason `OrderPaidPayload` restates Orders' shape (`orders-paid.consumers.ts`
 * doc comment): a consumer binding to a producer's internal domain type would couple the two
 * contexts at the code level. `ref` is the MERCHANT `tenantRef` this subscription bills, not the
 * ADR-0014 tenant scope (which lives on the envelope, per D-062 — billing is platform-owned).
 */
export interface LicensingSubscriptionChangedPayload {
  readonly ref: string;
  readonly family: string;
  readonly action: string;
}

export interface DunningNotificationTemplate {
  readonly eventType: string;
  readonly templateId: string;
  readonly subjectPattern: string;
  readonly bodyPattern: string;
}

/**
 * T14.5 — the three dunning state transitions a merchant must be told about. Kept to exactly what
 * the DoD's "detection ... notification ... recovery reporting" needs; nothing about `retry_scheduled`
 * (an intermediate, non-terminal state a merchant does not need paged for every hour).
 */
export const DUNNING_NOTIFICATION_TEMPLATES: readonly DunningNotificationTemplate[] = [
  {
    eventType: "licensing.subscription.entered_grace",
    templateId: "dunning-entered-grace",
    subjectPattern: "Your subscription payment failed",
    bodyPattern:
      "We could not collect your latest subscription payment. Your account is now in a grace " +
      "period while we retry automatically; please make sure your payment method is up to date.",
  },
  {
    eventType: "licensing.subscription.recovered_from_grace",
    templateId: "dunning-recovered",
    subjectPattern: "Your subscription payment succeeded",
    bodyPattern:
      "Your subscription payment was collected successfully. Your account is active again.",
  },
  {
    eventType: "licensing.subscription.dunning_exhausted",
    templateId: "dunning-exhausted",
    subjectPattern: "Your subscription has been suspended",
    bodyPattern:
      "We were unable to collect your subscription payment after several attempts. Your " +
      "subscription has been suspended; please update your payment method to restore service.",
  },
];

export interface DunningNotificationsConsumerDeps {
  readonly createNotification: CreateNotification;
  readonly logger: Logger;
}

/**
 * T14.5 (dunning) — opens a durable `Notification` row for a dunning state transition. Deliberately
 * "create and stop", the same scope `NotificationsOrdersPaidConsumer` already has (see that class's
 * doc comment): every provider in `services/notifications` is still an offline in-memory stub with
 * no delivery path, so calling `QueueNotification`/`SendNotification` from here would move nothing
 * real. What is different from an order confirmation: `apps/runtime/src/api.ts`'s
 * `assertProductionDunningNotificationsConfigured` refuses to boot outside `local` while that
 * remains true — this is the one message a merchant must receive before losing service, not a
 * missable nicety.
 *
 * `idempotencyKey` is derived from the event (`<eventType>:<messageId>`), not generated: a
 * redelivered event returns the already-created notification instead of a duplicate.
 */
export class DunningNotificationConsumer implements EventHandler<LicensingSubscriptionChangedPayload> {
  readonly eventType: string;
  readonly eventVersion = 1;
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private readonly template: DunningNotificationTemplate;
  private readonly deps: DunningNotificationsConsumerDeps;

  constructor(template: DunningNotificationTemplate, deps: DunningNotificationsConsumerDeps) {
    this.eventType = template.eventType;
    this.template = template;
    this.deps = deps;
  }

  async handle(event: IntegrationEvent<LicensingSubscriptionChangedPayload>): Promise<void> {
    // G-64: the notification is created under the envelope's tenant (the ADR-0014 platform scope
    // billing lives under, D-062 — never the merchant's own tenant scope). With none it is REFUSED
    // (nothing created, error logged): a skipped write denies.
    const tenantId = readEnvelopeTenant(event);
    if (tenantId === null) {
      this.deps.logger.error(
        `notifications: ${this.eventType} has no tenant on the envelope — refused`,
        {
          messageId: event.messageId,
        },
      );
      return;
    }
    const { ref: merchantTenantRef } = event.payload;
    const result = await this.deps.createNotification.execute({
      tenantId,
      idempotencyKey: `${this.eventType}:${event.messageId}`,
      sourceRef: `subscription:${event.aggregateId}`,
      recipientRef: merchantTenantRef,
      channels: ["email"],
      templateId: this.template.templateId,
      bodyPattern: this.template.bodyPattern,
      subjectPattern: this.template.subjectPattern,
      variables: { merchantTenantRef, subscriptionId: event.aggregateId },
      maxAttempts: DunningNotificationConsumer.DEFAULT_MAX_ATTEMPTS,
    });
    if (!result.ok) throw result.error;
  }
}

/**
 * Registers one Kafka consumer per dunning template (own consumer group per topic, so a poison
 * message on one never stalls the other two), composed directly against `core.prisma` — the
 * application layer only, never a Controller (same reasoning as `buildOrdersPaidConsumerRuntimes`).
 */
export function buildDunningNotificationsConsumerRuntimes(
  core: RuntimeCore,
  metrics?: MessagingMetrics,
): readonly SupervisedConsumer[] {
  const unitOfWork = new PrismaUnitOfWork(core.prisma);
  const context = rootEventContext(core.idGenerator);
  const outbox = new OutboxWriter({
    store: new PrismaOutboxStore(core.prisma),
    translator: new NotificationsEventTranslator(),
    serializer: core.serializer,
    clock: core.clock,
    producer: "notifications",
  });
  const createNotification = new CreateNotification({
    notifications: new PrismaNotificationRepository({ prisma: core.prisma, outbox, context }),
    unitOfWork,
    idGenerator: core.idGenerator,
    clock: core.clock,
  });

  const producer = new KafkaMessageProducer(core.kafka);
  return DUNNING_NOTIFICATION_TEMPLATES.map((template) =>
    buildProcessedConsumer(
      core,
      new DunningNotificationConsumer(template, { createNotification, logger: core.logger }),
      `notifications.${template.templateId}`,
      producer,
      metrics,
    ),
  );
}
