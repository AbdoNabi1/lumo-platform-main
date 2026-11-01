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
import {
  GetAccessStatus,
  GetPublicAccess,
  UpdateAccess,
  VerifyStorefrontPassword,
} from "./application/access.use-cases";
import type { OnlineStoreDeps } from "./application/deps";
import type {
  EventRecorder,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "./application/ports";
import { GetPreferences, UpdatePreferences } from "./application/preferences.use-cases";
import { IssuePreviewToken, ResolvePreviewToken } from "./application/preview.use-cases";
import { GetStorefrontShell } from "./application/shell.use-case";
import {
  DiscardThemeDraft,
  GetTheme,
  ListThemeReleases,
  PublishTheme,
  RestoreThemeRelease,
  SaveThemeDraft,
} from "./application/theme.use-cases";
import { ONLINE_STORE_PUBLISHED_EVENTS } from "./domain/events";
import { OnlineStoreEventTranslator } from "./infrastructure/event-translator";
import {
  InMemoryAccessRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaAccessRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./infrastructure/prisma-repositories";
import { OnlineStoreController } from "./interfaces/online-store.controller";
import type { ControllerResponse } from "./interfaces/presenter";

export interface OnlineStoreWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Present ⇒ Prisma repositories + PrismaUnitOfWork. ADR-0014: no tenant at composition time. */
  readonly prisma?: Database;
  readonly imageRefs: ImageRefsPort;
  readonly passwordHasher: StorefrontPasswordHasher;
  readonly shopHost: ShopHostPort;
  readonly storeIdentity: StoreIdentityPort;
}

export interface OnlineStoreRepos {
  readonly preferences: OnlineStoreDeps["preferences"];
  readonly access: OnlineStoreDeps["access"];
  readonly themes: OnlineStoreDeps["themes"];
  readonly releases: OnlineStoreDeps["releases"];
  readonly previewTokens: OnlineStoreDeps["previewTokens"];
}

/** Closures taking `tenantId` per call (spec "Composition"); nothing here holds a tenant. */
export interface OnlineStorePublicReads {
  readonly shell: (tenantId: string, previewToken?: string) => Promise<ControllerResponse>;
  readonly access: (tenantId: string) => Promise<ControllerResponse>;
  readonly unlock: (tenantId: string, password: string) => Promise<ControllerResponse>;
}

export interface WiredOnlineStore {
  readonly controller: OnlineStoreController;
  readonly publicReads: OnlineStorePublicReads;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Test seam (not exported from index.ts): the controller from given repositories. */
export function buildOnlineStoreController(
  repos: OnlineStoreRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  ports: Pick<
    OnlineStoreWiringDeps,
    "idGenerator" | "clock" | "imageRefs" | "passwordHasher" | "shopHost" | "storeIdentity"
  >,
  events: EventRecorder,
): OnlineStoreController {
  // Listed, never spread: a tenant on the wiring deps must not enter the graph (ADR-0014).
  const deps: OnlineStoreDeps = {
    ...repos,
    unitOfWork,
    events,
    idGenerator: ports.idGenerator,
    clock: ports.clock,
    imageRefs: ports.imageRefs,
    passwordHasher: ports.passwordHasher,
    shopHost: ports.shopHost,
    storeIdentity: ports.storeIdentity,
  };
  const resolvePreview = new ResolvePreviewToken(deps);
  return new OnlineStoreController({
    getPreferences: new GetPreferences(deps),
    updatePreferences: new UpdatePreferences(deps),
    getAccessStatus: new GetAccessStatus(deps),
    updateAccess: new UpdateAccess(deps),
    getPublicAccess: new GetPublicAccess(deps),
    verifyPassword: new VerifyStorefrontPassword(deps),
    getTheme: new GetTheme(deps),
    saveThemeDraft: new SaveThemeDraft(deps),
    discardThemeDraft: new DiscardThemeDraft(deps),
    publishTheme: new PublishTheme(deps),
    listThemeReleases: new ListThemeReleases(deps),
    restoreThemeRelease: new RestoreThemeRelease(deps),
    issuePreviewToken: new IssuePreviewToken(deps),
    getShell: new GetStorefrontShell(deps, resolvePreview),
  });
}

function publicReadsOf(controller: OnlineStoreController): OnlineStorePublicReads {
  return {
    shell: (tenantId, previewToken) =>
      controller.shell({ tenantId, ...(previewToken === undefined ? {} : { previewToken }) }),
    access: (tenantId) => controller.publicAccess({ tenantId }),
    unlock: (tenantId, password) => controller.unlock({ tenantId, password }),
  };
}

export function wireOnlineStore(deps: OnlineStoreWiringDeps): WiredOnlineStore {
  const translator = new OnlineStoreEventTranslator();
  const context = rootEventContext(deps.idGenerator); // no tenant: attached per write below
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator,
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "online-store",
    });
    const events: EventRecorder = {
      record: (list, tenantId, tx) => outbox.write(list, { ...context, tenantId }, tx as never),
    };
    const prisma = { prisma: deps.prisma };
    const controller = buildOnlineStoreController(
      {
        preferences: new PrismaPreferencesRepository(prisma),
        access: new PrismaAccessRepository(prisma),
        themes: new PrismaThemeRepository(prisma),
        releases: new PrismaThemeReleaseRepository(prisma),
        previewTokens: new PrismaPreviewTokenRepository(prisma),
      },
      new PrismaUnitOfWork(deps.prisma),
      deps,
      events,
    );
    return {
      controller,
      publicReads: publicReadsOf(controller),
      drainOutbox: () => Promise.resolve(0),
      deliveredEventTypes: [],
    };
  }

  const store = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store,
    translator,
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "online-store",
  });
  const events: EventRecorder = {
    record: (list, tenantId, tx) => outbox.write(list, { ...context, tenantId }, tx),
  };
  const controller = buildOnlineStoreController(
    {
      preferences: new InMemoryPreferencesRepository(),
      access: new InMemoryAccessRepository(),
      themes: new InMemoryThemeRepository(),
      releases: new InMemoryThemeReleaseRepository(),
      previewTokens: new InMemoryPreviewTokenRepository(),
    },
    new InMemoryUnitOfWork(),
    deps,
    events,
  );
  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = (record) => {
    delivered.push(record.headers.type ?? record.topic);
    return Promise.resolve();
  };
  for (const type of ONLINE_STORE_PUBLISHED_EVENTS) bus.subscribe(`${type}.v1`, sink);
  const relay = new OutboxRelay({
    store,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });
  return {
    controller,
    publicReads: publicReadsOf(controller),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
