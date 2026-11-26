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
import type {
  NotificationLog,
  RecipientResolverPort,
  StoreMailSender,
  StoreProfilePort,
} from "./application/messaging-ports";
import type {
  EmailConnectionVault,
  StoreEmailProvider,
} from "./application/email-connection-ports";
import { StoreEmailDelivery } from "./application/store-email-delivery";
import {
  DeleteEmailConnection,
  GetEmailConnection,
  SaveEmailConnection,
  SetEmailConnectionEnabled,
  TestEmailConnection,
} from "./application/email-connection.use-cases";
import { TemplatedNotifier } from "./application/templated-notifier";
import { TemplatedEmailProvider } from "./infrastructure/templated-email-provider";
import type { EmailProviderPort } from "./application/ports";
import type {
  EmailConnectionRepository,
  NotificationSettingsRepository,
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
  InMemoryProcessedProviderCallbackStore,
  InMemoryPushProvider,
  InMemorySmsProvider,
  InMemoryWebhookProvider,
} from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  InMemoryEmailConnectionRepository,
  InMemoryNotificationSettingsRepository,
  InMemoryTemplateOverrideRepository,
} from "./infrastructure/in-memory-messaging-repositories";
import {
  PrismaEmailConnectionRepository,
  PrismaNotificationSettingsRepository,
  PrismaTemplateOverrideRepository,
} from "./infrastructure/prisma-messaging-repositories";
import {
  NOTIFICATIONS_PUBLISHED_EVENTS,
  NotificationsEventTranslator,
} from "./infrastructure/notifications-event-translator";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification-repository";
import { NotificationSettingsController } from "./interfaces/notification-settings.controller";
import { EmailConnectionController } from "./interfaces/email-connection.controller";
import { NotificationsController } from "./interfaces/notifications.controller";

/**
 * What Settings > Notifications needs from outside the context. Present in the admin app's wiring
 * (store profile from Tenancy/Online store); absent in the bare in-memory wiring, where the store has
 * no name or contact. Customer mail goes ONLY through the store's own email connection (Wave 2b2,
 * D45/D46): there is no platform mailbox here and nothing to fall back to.
 */
export interface NotificationsMessagingDeps {
  readonly store: StoreProfilePort;
  /** Resolves a customer reference to a name, address and language at send time. Absent ⇒ nobody is found. */
  readonly recipients?: RecipientResolverPort;
  /** Failure logging for the email channel: short codes only, never an address or a body. */
  readonly log?: NotificationLog;
  /**
   * Seals the merchants' email keys (D48). Absent (no `EMAIL_CREDENTIALS_KEK_REF` outside local) ⇒
   * saving a connection answers 503 NOT_CONFIGURED and nothing can be sent.
   */
  readonly emailVault?: EmailConnectionVault;
  /** Calls the merchant's own provider (Resend HTTPS) with THEIR key. Absent ⇒ nothing can be sent. */
  readonly emailProvider?: StoreEmailProvider;
  /** Mailbox (SMTP) accounts may be connected and used (`EMAIL_SMTP_ENABLED`). Default off. */
  readonly smtpEnabled?: boolean;
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
  /** The store's own email account: connect, test, switch, disconnect (D46-D49). */
  readonly emailConnection: EmailConnectionController;
  /** The one way a store's mail is sent: through its own connection, resolved per call (D46). */
  readonly storeMail: StoreMailSender;
  /** The one entry the order/payment/fulfilment/draft triggers use to send a templated mail (Wave 2b). */
  readonly notifier: TemplatedNotifier;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface MessagingRepositories {
  readonly settings: NotificationSettingsRepository;
  readonly overrides: TemplateOverrideRepository;
  readonly connections: EmailConnectionRepository;
}

const UNCONFIGURED_MESSAGING: NotificationsMessagingDeps = {
  store: { get: () => Promise.resolve({ storeName: "", contactEmail: null, defaultLocale: null }) },
};

function buildSettingsController(
  repos: MessagingRepositories,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  messaging: NotificationsMessagingDeps,
  storeMail: StoreMailSender,
): NotificationSettingsController {
  const templateDeps = {
    settings: repos.settings,
    overrides: repos.overrides,
    store: messaging.store,
  };
  const settingsDeps = {
    settings: repos.settings,
    store: messaging.store,
    unitOfWork,
    connections: repos.connections,
  };
  return new NotificationSettingsController({
    getSettings: new GetNotificationSettings(settingsDeps),
    updateSettings: new UpdateNotificationSettings(settingsDeps),
    listTemplates: new ListNotificationTemplates(templateDeps),
    getTemplate: new GetNotificationTemplate(templateDeps),
    putTemplate: new PutNotificationTemplate(templateDeps),
    revertTemplate: new RevertNotificationTemplate(templateDeps),
    previewTemplate: new PreviewNotificationTemplate(templateDeps),
    sendTest: new SendTestEmail({ ...templateDeps, mail: storeMail }),
  });
}

function buildEmailConnectionController(
  deps: NotificationsWiringDeps,
  repos: MessagingRepositories,
  messaging: NotificationsMessagingDeps,
): EmailConnectionController {
  const connectionDeps = {
    connections: repos.connections,
    store: messaging.store,
    clock: deps.clock,
    ...(messaging.emailVault === undefined ? {} : { vault: messaging.emailVault }),
    ...(messaging.emailProvider === undefined ? {} : { provider: messaging.emailProvider }),
    smtpEnabled: messaging.smtpEnabled === true,
  };
  return new EmailConnectionController({
    getConnection: new GetEmailConnection(connectionDeps),
    saveConnection: new SaveEmailConnection(connectionDeps),
    setEnabled: new SetEmailConnectionEnabled(connectionDeps),
    deleteConnection: new DeleteEmailConnection(connectionDeps),
    testConnection: new TestEmailConnection(connectionDeps),
  });
}

interface BuiltController {
  readonly controller: NotificationsController;
  readonly create: CreateNotification;
  readonly queue: QueueNotification;
  readonly send: SendNotification;
  readonly advance: AdvanceNotification;
}

/** Builds the `NotificationsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  notifications: NotificationRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: NotificationsWiringDeps,
  emailProvider: EmailProviderPort,
): BuiltController {
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

  const create = new CreateNotification(lifecycleDeps);
  const queue = new QueueNotification(lifecycleDeps);
  const send = new SendNotification({
    ...lifecycleDeps,
    emailProvider,
    smsProvider,
    pushProvider,
    webhookProvider,
  });
  const advance = new AdvanceNotification(lifecycleDeps);
  const controller = new NotificationsController({
    createNotification: create,
    queueNotification: queue,
    sendNotification: send,
    retryNotification: new RetryNotification(lifecycleDeps),
    advanceNotification: advance,
    recordProviderCallback: new RecordProviderCallback({
      ...lifecycleDeps,
      processedProviderCallbacks,
    }),
    listNotifications: new ListNotifications({ notifications }),
    getNotification: new GetNotification({ notifications }),
  });
  return { controller, create, queue, send, advance };
}

const NO_RECIPIENTS: RecipientResolverPort = { resolve: () => Promise.resolve(null) };
const SILENT_LOG: NotificationLog = { warn: () => undefined };

/** Everything both persistence branches share once their repositories exist. */
function assemble(
  deps: NotificationsWiringDeps,
  notifications: NotificationRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  repos: MessagingRepositories,
  messaging: NotificationsMessagingDeps,
): Pick<
  WiredNotifications,
  "notifications" | "settings" | "emailConnection" | "storeMail" | "notifier"
> {
  const storeMail = new StoreEmailDelivery({
    connections: repos.connections,
    clock: deps.clock,
    ...(messaging.emailVault === undefined ? {} : { vault: messaging.emailVault }),
    ...(messaging.emailProvider === undefined ? {} : { provider: messaging.emailProvider }),
    smtpEnabled: messaging.smtpEnabled === true,
  });
  const emailProvider = new TemplatedEmailProvider({
    settings: repos.settings,
    overrides: repos.overrides,
    store: messaging.store,
    recipients: messaging.recipients ?? NO_RECIPIENTS,
    mail: storeMail,
    log: messaging.log ?? SILENT_LOG,
  });
  const built = buildController(notifications, unitOfWork, deps, emailProvider);
  return {
    notifications: built.controller,
    settings: buildSettingsController(repos, unitOfWork, messaging, storeMail),
    emailConnection: buildEmailConnectionController(deps, repos, messaging),
    storeMail,
    notifier: new TemplatedNotifier({
      settings: repos.settings,
      create: built.create,
      queue: built.queue,
      send: built.send,
      advance: built.advance,
    }),
  };
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
      ...assemble(
        deps,
        notifications,
        unitOfWork,
        {
          settings: new PrismaNotificationSettingsRepository(deps.prisma),
          overrides: new PrismaTemplateOverrideRepository(deps.prisma),
          connections: new PrismaEmailConnectionRepository(deps.prisma),
        },
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
  const wired = assemble(
    deps,
    notifications,
    unitOfWork,
    {
      settings: new InMemoryNotificationSettingsRepository(),
      overrides: new InMemoryTemplateOverrideRepository(),
      connections: new InMemoryEmailConnectionRepository(),
    },
    messaging,
  );

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
    ...wired,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
