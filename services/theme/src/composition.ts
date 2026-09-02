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
import { GetTheme } from "./application/get-theme.use-case";
import { ListThemes } from "./application/list-themes.use-case";
import type { DesignPresetProvider } from "./application/theme-preset.port";
import { AdvanceTheme, CreateTheme, UpdateThemeVariables } from "./application/theme.use-cases";
import type { ThemeRepository } from "./domain/repositories";
import { InMemoryDesignPresetProvider } from "./infrastructure/design-preset-provider";
import { InMemoryThemeRepository } from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaThemeRepository } from "./infrastructure/prisma-repositories";
import {
  THEME_PUBLISHED_EVENTS,
  ThemeEventTranslator,
} from "./infrastructure/theme-event-translator";
import { ThemeController } from "./interfaces/theme.controller";

export interface ThemeWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly presets?: DesignPresetProvider;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaThemeRepository` + `PrismaUnitOfWork`
   * (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireComponents`); absent ⇒
   * in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Theme table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredTheme {
  readonly theme: ThemeController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ThemeController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  themes: ThemeRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ThemeWiringDeps,
): ThemeController {
  const presets = deps.presets ?? new InMemoryDesignPresetProvider();
  const themeDeps = { themes, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new ThemeController({
    createTheme: new CreateTheme({ ...themeDeps, presets }),
    advanceTheme: new AdvanceTheme(themeDeps),
    updateThemeVariables: new UpdateThemeVariables(themeDeps),
    listThemes: new ListThemes({ themes }),
    getTheme: new GetTheme({ themes }),
  });
}

/**
 * Composition root for the Theme context. Prisma slice (`PrismaThemeRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireTheme(deps: ThemeWiringDeps): WiredTheme {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireTheme: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ThemeEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "theme",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const themes = new PrismaThemeRepository({ prisma: deps.prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      theme: buildController(themes, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ThemeEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "theme",
  });
  const context = rootEventContext(deps.idGenerator);

  const themes = new InMemoryThemeRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(themes, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of THEME_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    theme: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
