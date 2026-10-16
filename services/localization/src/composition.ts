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
import { GetLocale } from "./application/get-locale.use-case";
import { GetTranslationSet } from "./application/get-translation-set.use-case";
import { ListLocales } from "./application/list-locales.use-case";
import { ListTranslationSets } from "./application/list-translation-sets.use-case";
import {
  CreateLocale,
  CreateTranslationSet,
  PublishTranslation,
  SetTranslation,
} from "./application/localization.use-cases";
import type { LocaleRepository, TranslationSetRepository } from "./domain/repositories";
import {
  InMemoryLocaleRepository,
  InMemoryTranslationSetRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  LOCALIZATION_PUBLISHED_EVENTS,
  LocalizationEventTranslator,
} from "./infrastructure/localization-event-translator";
import {
  PrismaLocaleRepository,
  PrismaTranslationSetRepository,
} from "./infrastructure/prisma-repositories";
import { LocalizationController } from "./interfaces/localization.controller";

export interface LocalizationWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaLocaleRepository` +
   * `PrismaTranslationSetRepository` + `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. ADR-0014
   * (WP-10, T10.5): the repositories built here are tenant-agnostic singletons — no `tenantId` at
   * composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredLocalization {
  readonly localization: LocalizationController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface LocalizationRepos {
  readonly locales: LocaleRepository;
  readonly translationSets: TranslationSetRepository;
}

/** Builds the `LocalizationController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: LocalizationRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: LocalizationWiringDeps,
): LocalizationController {
  const localizationDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new LocalizationController({
    createLocale: new CreateLocale(localizationDeps),
    createTranslationSet: new CreateTranslationSet(localizationDeps),
    setTranslation: new SetTranslation(localizationDeps),
    publishTranslation: new PublishTranslation(localizationDeps),
    listLocales: new ListLocales({ locales: repos.locales }),
    getLocale: new GetLocale({ locales: repos.locales }),
    listTranslationSets: new ListTranslationSets({ translationSets: repos.translationSets }),
    getTranslationSet: new GetTranslationSet({ translationSets: repos.translationSets }),
  });
}

/**
 * Composition root for the Localization context. Prisma slice (both repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireLocalization(deps: LocalizationWiringDeps): WiredLocalization {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new LocalizationEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "localization",
    });
    const context = rootEventContext(deps.idGenerator);
    const localizationDeps = { prisma: deps.prisma, outbox, context };
    const repos: LocalizationRepos = {
      locales: new PrismaLocaleRepository(localizationDeps),
      translationSets: new PrismaTranslationSetRepository(localizationDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      localization: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new LocalizationEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "localization",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: LocalizationRepos = {
    locales: new InMemoryLocaleRepository({ outbox: outboxWriter, context }),
    translationSets: new InMemoryTranslationSetRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of LOCALIZATION_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    localization: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
