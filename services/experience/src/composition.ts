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
  AdvanceExperience,
  CreateExperience,
  UpdateCanvas,
} from "./application/experience.use-cases";
import { GetExperience } from "./application/get-experience.use-case";
import { ListExperiences } from "./application/list-experiences.use-case";
import type { ExperienceRepository } from "./domain/repositories";
import {
  EXPERIENCE_PUBLISHED_EVENTS,
  ExperienceEventTranslator,
} from "./infrastructure/experience-event-translator";
import { InMemoryExperienceRepository } from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaExperienceRepository } from "./infrastructure/prisma-repositories";
import { ExperienceController } from "./interfaces/experience.controller";

export interface ExperienceWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaExperienceRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireTheme`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Experience table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredExperience {
  readonly experience: ExperienceController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ExperienceController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  experiences: ExperienceRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ExperienceWiringDeps,
): ExperienceController {
  const experienceDeps = {
    experiences,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new ExperienceController({
    createExperience: new CreateExperience(experienceDeps),
    advanceExperience: new AdvanceExperience(experienceDeps),
    updateCanvas: new UpdateCanvas(experienceDeps),
    listExperiences: new ListExperiences({ experiences }),
    getExperience: new GetExperience({ experiences }),
  });
}

/**
 * Composition root for the Experience context. Prisma slice (`PrismaExperienceRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireExperience(deps: ExperienceWiringDeps): WiredExperience {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireExperience: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ExperienceEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "experience",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const experiences = new PrismaExperienceRepository({
      prisma: deps.prisma,
      tenantId,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      experience: buildController(experiences, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ExperienceEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "experience",
  });
  const context = rootEventContext(deps.idGenerator);

  const experiences = new InMemoryExperienceRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(experiences, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of EXPERIENCE_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    experience: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
