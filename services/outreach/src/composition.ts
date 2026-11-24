import type { Database } from "@platform/db";
import { PrismaOutboxStore } from "@platform/db";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import { OutboxWriter } from "@platform/messaging";
import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { ConnectWhatsApp } from "./application/connect-whatsapp.use-case";
import { RecordConsent, UpsertContact } from "./application/contact.use-cases";
import {
  AbandonWhatsAppOnboarding,
  DisconnectWhatsApp,
  GetWhatsAppConnection,
  RefreshWhatsAppStatus,
} from "./application/connection.use-cases";
import { GetEmailSettings } from "./application/email-settings.use-case";
import type { OutreachEventSink } from "./application/events";
import {
  DEFAULT_UNRESOLVED_AFTER_MS,
  type OutreachDeps,
  type StoreProfilePort,
} from "./application/outreach-deps";
import type {
  EmailSendPort,
  OutreachCredentialVault,
  WhatsAppCloudApiPort,
} from "./application/ports";
import { ReconcileUnresolvedOutbound } from "./application/reconcile-unresolved.use-case";
import {
  SendEmail,
  SendWhatsAppSessionMessage,
  SendWhatsAppTemplate,
} from "./application/send.use-cases";
import {
  CreateTemplate,
  DeleteTemplate,
  ListTemplates,
  SyncTemplates,
} from "./application/template.use-cases";
import { ProcessWhatsAppWebhook } from "./application/webhook.use-case";
import type { OutreachRepositories } from "./domain/repositories";
import { createInMemoryOutreach } from "./infrastructure/in-memory-outreach-wiring";
import {
  OutboxOutreachEventSink,
  OutreachEventTranslator,
} from "./infrastructure/outbox-outreach-event-sink";
import { PrismaOutboundMessageRepository } from "./infrastructure/prisma-outreach-repositories";
import { PrismaOutreachUnitOfWork } from "./infrastructure/prisma-outreach-unit-of-work";
import { createPrismaOutreach } from "./infrastructure/prisma-outreach-wiring";
import { OutreachController } from "./interfaces/outreach.controller";
import { InMemoryOutreachEventRecorder } from "./testing/in-memory-outreach-event-recorder";

export interface OutreachWiringDeps {
  serializer: EventSerializer;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Scope of the platform-level phone directory (the webhook has no tenant). Required, no default. */
  platformTenantId: string;
  /** Present ⇒ Prisma repositories + `PrismaUnitOfWork`; absent ⇒ in-memory (tests / local). */
  prisma?: Database;
  /** Both or neither (readiness is decided in the runtime). Undefined stays undefined: the `available:false` path. */
  whatsapp?: WhatsAppCloudApiPort;
  vault?: OutreachCredentialVault;
  email?: EmailSendPort;
  emailFrom?: string;
  emailCaps: { perHour: number; perDay: number };
  storeProfile: StoreProfilePort;
  /** `crypto.randomInt(0, 1_000_000)` padded to 6 ASCII digits. */
  randomPin: () => string;
  /** Absent + prisma ⇒ the outbox sink; absent + no prisma ⇒ `InMemoryOutreachEventRecorder`. */
  events?: OutreachEventSink;
  /**
   * Test seam: called once with the SAME in-memory repositories the use cases run on (read handle for assertions).
   * Never called when `prisma` is present, so production wiring cannot reach it.
   */
  inspectInMemory?: (repositories: OutreachRepositories) => void;
  /** `OUTREACH_UNRESOLVED_AFTER_MS` (default 300000; must exceed the provider timeout). */
  unresolvedAfterMs?: number;
}

export interface WiredOutreach {
  outreach: OutreachController;
  webhook: {
    process(payload: unknown): Promise<Result<{ processed: number; skipped: number }, DomainError>>;
  };
  /** In-memory wiring only has nothing to drain (events go to the recorder); Prisma relies on the platform relay. */
  drainOutbox: () => Promise<number>;
  deliveredEventTypes: readonly string[];
  /** Tenant-scoped recovery of unresolved sends (also built stand-alone by `wireOutreachRecovery`). */
  reconcileUnresolved: (tenantId: string) => Promise<number>;
}

function outboxSink(deps: {
  prisma: Database;
  serializer: EventSerializer;
  clock: Clock;
}): OutreachEventSink {
  return new OutboxOutreachEventSink(
    new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new OutreachEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "outreach",
    }),
  );
}

function repositories(deps: OutreachWiringDeps): OutreachRepositories & {
  unitOfWork: OutreachDeps["unitOfWork"];
} {
  if (deps.prisma !== undefined) {
    const p = createPrismaOutreach({
      prisma: deps.prisma,
      clock: deps.clock,
      platformTenantId: deps.platformTenantId,
    });
    return {
      unitOfWork: p.unitOfWork,
      connections: p.connections,
      directory: p.directory,
      templates: p.templates,
      contacts: p.contacts,
      outbound: p.outbound,
      inbound: p.inbound,
      unmatched: p.unmatched,
      emailCounters: p.emailCounters,
    };
  }
  const m = createInMemoryOutreach({ clock: deps.clock, platformTenantId: deps.platformTenantId });
  deps.inspectInMemory?.(m);
  return {
    unitOfWork: m.unitOfWork,
    connections: m.connections,
    directory: m.directory,
    templates: m.templates,
    contacts: m.contacts,
    outbound: m.outbound,
    inbound: m.inbound,
    unmatched: m.unmatched,
    emailCounters: m.emailCounters,
  };
}

/**
 * Composition root of the Outreach context. Prisma present ⇒ Prisma repositories, `PrismaUnitOfWork` and the outbox sink;
 * absent ⇒ in-memory with a recording event sink. No InMemory send ports are ever defaulted: an undefined port is the
 * "platform not configured" (`available:false`) path, like the carriers' "no stub default" rule.
 */
export function wireOutreach(deps: OutreachWiringDeps): WiredOutreach {
  const events: OutreachEventSink =
    deps.events ??
    (deps.prisma !== undefined
      ? outboxSink({ ...deps, prisma: deps.prisma })
      : new InMemoryOutreachEventRecorder());
  const d: OutreachDeps = {
    ...repositories(deps),
    whatsapp: deps.whatsapp,
    vault: deps.vault,
    email: deps.email,
    emailFrom: deps.emailFrom,
    emailCaps: deps.emailCaps,
    storeProfile: deps.storeProfile,
    randomPin: deps.randomPin,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    events,
    unresolvedAfterMs: deps.unresolvedAfterMs ?? DEFAULT_UNRESOLVED_AFTER_MS,
  };
  const webhook = new ProcessWhatsAppWebhook(d);
  const reconcile = new ReconcileUnresolvedOutbound(d);
  return {
    outreach: new OutreachController({
      getConnection: new GetWhatsAppConnection(d),
      connect: new ConnectWhatsApp(d),
      refresh: new RefreshWhatsAppStatus(d),
      disconnect: new DisconnectWhatsApp(d),
      abandon: new AbandonWhatsAppOnboarding(d),
      listTemplates: new ListTemplates(d),
      syncTemplates: new SyncTemplates(d),
      createTemplate: new CreateTemplate(d),
      deleteTemplate: new DeleteTemplate(d),
      upsertContact: new UpsertContact(d),
      recordConsent: new RecordConsent(d),
      sendTemplate: new SendWhatsAppTemplate(d),
      sendSession: new SendWhatsAppSessionMessage(d),
      sendEmail: new SendEmail(d),
      emailSettings: new GetEmailSettings(d),
    }),
    webhook: { process: (payload) => webhook.execute({ payload }) },
    drainOutbox: () => Promise.resolve(0),
    deliveredEventTypes: [],
    reconcileUnresolved: async (tenantId) => {
      const result = await reconcile.execute({ tenantId });
      return result.ok ? result.value : 0;
    },
  };
}

/**
 * The recovery job's own wiring (it must not depend on the admin HTTP composition): the Prisma outbound repository,
 * the tenant-scoped `PrismaOutreachUnitOfWork` and the outbox sink only. It needs no providers, vault or ports and never calls a provider.
 */
export function wireOutreachRecovery(d: {
  prisma: Database;
  clock: Clock;
  idGenerator: IdGenerator;
  serializer: EventSerializer;
  reconcileAfterMs: number;
}): { reconcileUnresolved(tenantId: string): Promise<number> } {
  const reconcile = new ReconcileUnresolvedOutbound({
    outbound: new PrismaOutboundMessageRepository({ prisma: d.prisma }),
    unitOfWork: new PrismaOutreachUnitOfWork(d.prisma),
    clock: d.clock,
    idGenerator: d.idGenerator,
    events: outboxSink({ prisma: d.prisma, serializer: d.serializer, clock: d.clock }),
    unresolvedAfterMs: d.reconcileAfterMs,
  });
  return {
    reconcileUnresolved: async (tenantId) => {
      const result = await reconcile.execute({ tenantId });
      return result.ok ? result.value : 0;
    },
  };
}
