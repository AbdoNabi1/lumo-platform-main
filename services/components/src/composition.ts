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
  AdvanceComponentDefinition,
  CreateComponentDefinition,
} from "./application/components.use-cases";
import { GetComponentDefinition } from "./application/get-component-definition.use-case";
import { ListComponentDefinitions } from "./application/list-component-definitions.use-case";
import type { ComponentDefinitionRepository } from "./domain/repositories";
import {
  COMPONENTS_PUBLISHED_EVENTS,
  ComponentsEventTranslator,
} from "./infrastructure/components-event-translator";
import { InMemoryComponentDefinitionRepository } from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaComponentDefinitionRepository } from "./infrastructure/prisma-repositories";
import { ComponentsController } from "./interfaces/components.controller";

export interface ComponentsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaComponentDefinitionRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/`wireSeo`);
   * absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Components table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredComponents {
  readonly components: ComponentsController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ComponentsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  definitions: ComponentDefinitionRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ComponentsWiringDeps,
): ComponentsController {
  const componentsDeps = {
    definitions,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new ComponentsController({
    createComponentDefinition: new CreateComponentDefinition(componentsDeps),
    advanceComponentDefinition: new AdvanceComponentDefinition(componentsDeps),
    listComponentDefinitions: new ListComponentDefinitions({ definitions }),
    getComponentDefinition: new GetComponentDefinition({ definitions }),
  });
}

/**
 * Composition root for the Components context. Prisma slice
 * (`PrismaComponentDefinitionRepository` + `PrismaUnitOfWork`) when `prisma` is present; else
 * in-memory.
 */
export function wireComponents(deps: ComponentsWiringDeps): WiredComponents {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireComponents: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ComponentsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "components",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const definitions = new PrismaComponentDefinitionRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      components: buildController(definitions, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ComponentsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "components",
  });
  const context = rootEventContext(deps.idGenerator);

  const definitions = new InMemoryComponentDefinitionRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(definitions, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of COMPONENTS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    components: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
