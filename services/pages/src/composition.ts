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
import { GetPage } from "./application/get-page.use-case";
import { GetTemplate } from "./application/get-template.use-case";
import { ListPages } from "./application/list-pages.use-case";
import { ListTemplates } from "./application/list-templates.use-case";
import {
  AdvancePage,
  ArchiveTemplate,
  CreatePage,
  CreateTemplate,
} from "./application/pages.use-cases";
import type { PageRepository, TemplateRepository } from "./domain/repositories";
import {
  InMemoryPageRepository,
  InMemoryTemplateRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PAGES_PUBLISHED_EVENTS,
  PagesEventTranslator,
} from "./infrastructure/pages-event-translator";
import {
  PrismaPageRepository,
  PrismaTemplateRepository,
} from "./infrastructure/prisma-repositories";
import { PagesController } from "./interfaces/pages.controller";

export interface PagesWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaPageRepository` +
   * `PrismaTemplateRepository` + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wireInventory`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Pages table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredPages {
  readonly pages: PagesController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface PagesRepos {
  readonly pages: PageRepository;
  readonly templates: TemplateRepository;
}

/** Builds the `PagesController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: PagesRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: PagesWiringDeps,
): PagesController {
  const pagesDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new PagesController({
    createPage: new CreatePage(pagesDeps),
    advancePage: new AdvancePage(pagesDeps),
    createTemplate: new CreateTemplate(pagesDeps),
    archiveTemplate: new ArchiveTemplate(pagesDeps),
    listPages: new ListPages({ pages: repos.pages }),
    getPage: new GetPage({ pages: repos.pages }),
    listTemplates: new ListTemplates({ templates: repos.templates }),
    getTemplate: new GetTemplate({ templates: repos.templates }),
  });
}

/**
 * Composition root for the Pages context. Prisma slice (both repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wirePages(deps: PagesWiringDeps): WiredPages {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wirePages: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new PagesEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "pages",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const pagesDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: PagesRepos = {
      pages: new PrismaPageRepository(pagesDeps),
      templates: new PrismaTemplateRepository(pagesDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      pages: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new PagesEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "pages",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: PagesRepos = {
    pages: new InMemoryPageRepository({ outbox: outboxWriter, context }),
    templates: new InMemoryTemplateRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of PAGES_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    pages: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
