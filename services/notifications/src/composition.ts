import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { EmailDeliveryPort, StoreProfilePort } from "./application/messaging-ports";
import type {
  NotificationSettingsRepository,
  SenderDomainReader,
  TemplateOverrideRepository,
} from "./domain/messaging/messaging-repositories";
import {
  GetNotificationSettings,
  UpdateNotificationSettings,
} from "./application/notification-settings.use-cases";
import {
  GetNotificationTemplate,
  ListNotificationTemplates,
  PreviewNotificationTemplate,
  PutNotificationTemplate,
  RevertNotificationTemplate,
  SendTestEmail,
} from "./application/notification-templates.use-cases";
import { CreateNotification } from "./application/create-notification.use-case";
import { GetNotification } from "./application/get-notification.use-case";
import { ListNotifications } from "./application/list-notifications.use-case";
import {
  AdvanceNotification,
  QueueNotification,
  RetryNotification,
  SendNotification,
} from "./application/notification-lifecycle.use-cases";
import { RecordProviderCallback } from "./application/record-provider-callback.use-case";
import type { NotificationRepository } from "./domain/notification-repository";
import { InMemoryNotificationRepository } from "./infrastructure/in-memory-notification-repository";
import {
  InMemoryEmailProvider,
  InMemoryProcessedProviderCallbackStore,
  InMemoryPushProvider,
  InMemorySmsProvider,
  InMemoryWebhookProvider,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  InMemoryNotificationSettingsRepository,
  InMemorySenderDomainReader,
  InMemoryTemplateOverrideRepository,
} from "./infrastructure/in-memory-messaging-repositories";
import {
  PrismaNotificationSettingsRepository,
  PrismaSenderDomainReader,
  PrismaTemplateOverrideRepository,
} from "./infrastructure/prisma-messaging-repositories";
import {
  NOTIFICATIONS_PUBLISHED_EVENTS,
  NotificationsEventTranslator,
} from "./infrastructure/notifications-event-translator";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification-repository";
import { NotificationSettingsController } from "./interfaces/notification-settings.controller";
import { NotificationsController } from "./interfaces/notifications.controller";

/** The default platform mailbox: the same as the runtime's `EMAIL_FROM` default. */
export const DEFAULT_PLATFORM_FROM = "Morbeh <onboarding@resend.dev>";

/**
 * Wave 2b: what Settings > Notifications needs from outside the context. Present in the admin app's
 * wiring (store profile from Tenancy/Online store, delivery over the runtime's `EmailSender`); absent
 * in the bare in-memory wiring, where the store has no name or contact and nothing is delivered.
 */
export interface NotificationsMessagingDeps {
  readonly store: StoreProfilePort;
  readonly delivery: EmailDeliveryPort;
  /** Tests seed verified domains here; production reads `notifications.sender_domains`. */
  readonly senderDomains?: SenderDomainReader;
}

export interface NotificationsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaNotificationRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireReturns`); absent ⇒ in-memory, unchanged. All 4 provider ports stay in-memory stubs in
   * both branches (no real providers, per the report's own "in-memory stubs only" scope) — out of
   * scope for C-01.
   */
  readonly prisma?: Database;
}

export interface WiredNotifications {
  readonly notifications: NotificationsController;
  /** Settings > Notifications: sender, templates, preview, test-send (Wave 2b). */
  readonly settings: NotificationSettingsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `NotificationsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
interface MessagingRepositories {
  readonly settings: NotificationSettingsRepository;
  readonly overrides: TemplateOverrideRepository;
  readonly senderDomains: SenderDomainReader;
}

const UNCONFIGURED_MESSAGING: NotificationsMessagingDeps = {
  store: { get: () => Promise.resolve({ storeName: "", contactEmail: null, defaultLocale: null }) },
  delivery: {
    deliveryConfigured: false,
    platformFrom: DEFAULT_PLATFORM_FROM,
    send: () => Promise.reject(new Error("EMAIL_NOT_CONFIGURED")),
  },
};

function buildSettingsController(
  repos: MessagingRepositories,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  messaging: NotificationsMessagingDeps,
): NotificationSettingsController {
  const senderDomains = messaging.senderDomains ?? repos.senderDomains;
  const templateDeps = {
    settings: repos.settings,
    overrides: repos.overrides,
    store: messaging.store,
    senderDomains,
    platformFrom: messaging.delivery.platformFrom,
  };
  const settingsDeps = {
    settings: repos.settings,
    store: messaging.store,
    senderDomains,
    platformFrom: messaging.delivery.platformFrom,
    unitOfWork,
    deliveryConfigured: messaging.delivery.deliveryConfigured,
  };
  return new NotificationSettingsController({
    getSettings: new GetNotificationSettings(settingsDeps),
    updateSettings: new UpdateNotificationSettings(settingsDeps),
    listTemplates: new ListNotificationTemplates(templateDeps),
    getTemplate: new GetNotificationTemplate(templateDeps),
    putTemplate: new PutNotificationTemplate(templateDeps),
    revertTemplate: new RevertNotificationTemplate(templateDeps),
    previewTemplate: new PreviewNotificationTemplate(templateDeps),
    sendTest: new SendTestEmail({ ...templateDeps, delivery: messaging.delivery }),
  });
}

function buildController(
  notifications: NotificationRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: NotificationsWiringDeps,
): NotificationsController {
  const emailProvider = new InMemoryEmailProvider();
  const smsProvider = new InMemorySmsProvider();
  const pushProvider = new InMemoryPushProvider();
  const webhookProvider = new InMemoryWebhookProvider();
  const processedProviderCallbacks = new InMemoryProcessedProviderCallbackStore();

  const lifecycleDeps = {
    notifications,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new NotificationsController({
    createNotification: new CreateNotification(lifecycleDeps),
    queueNotification: new QueueNotification(lifecycleDeps),
    sendNotification: new SendNotification({
      ...lifecycleDeps,
      emailProvider,
      smsProvider,
      pushProvider,
      webhookProvider,
    }),
    retryNotification: new RetryNotification(lifecycleDeps),
    advanceNotification: new AdvanceNotification(lifecycleDeps),
    recordProviderCallback: new RecordProviderCallback({
      ...lifecycleDeps,
      processedProviderCallbacks,
    }),
    listNotifications: new ListNotifications({ notifications }),
    getNotification: new GetNotification({ notifications }),
  });
}

/**
 * Composition root for the Notifications context. Prisma slice (`PrismaNotificationRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory, including offline stubs for all 4
 * provider ports (no real providers, per the report's own "in-memory stubs only" scope).
 */
export function wireNotifications(
  deps: NotificationsWiringDeps,
  messaging: NotificationsMessagingDeps = UNCONFIGURED_MESSAGING,
): WiredNotifications {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new NotificationsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "notifications",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time (see NotificationsWiringDeps) — every
    // repository takes it per call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const notifications = new PrismaNotificationRepository({
      prisma: deps.prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      notifications: buildController(notifications, unitOfWork, deps),
      settings: buildSettingsController(
        {
          settings: new PrismaNotificationSettingsRepository(deps.prisma),
          overrides: new PrismaTemplateOverrideRepository(deps.prisma),
          senderDomains: new PrismaSenderDomainReader(deps.prisma),
        },
        unitOfWork,
        messaging,
      ),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new NotificationsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "notifications",
  });
  const context = rootEventContext(deps.idGenerator);

  const notifications = new InMemoryNotificationRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(notifications, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of NOTIFICATIONS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    notifications: controller,
    settings: buildSettingsController(
      {
        settings: new InMemoryNotificationSettingsRepository(),
        overrides: new InMemoryTemplateOverrideRepository(),
        senderDomains: new InMemorySenderDomainReader(),
      },
      unitOfWork,
      messaging,
    ),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
