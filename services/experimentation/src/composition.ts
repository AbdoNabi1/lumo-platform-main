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
  AdvanceExperiment,
  CreateExperiment,
  DeclareWinner,
  RecordExperimentResult,
} from "./application/experiment.use-cases";
import { GetExperiment } from "./application/get-experiment.use-case";
import { ListExperiments } from "./application/list-experiments.use-case";
import type { ExperimentRepository } from "./domain/experiment-repository";
import {
  EXPERIMENTATION_PUBLISHED_EVENTS,
  ExperimentationEventTranslator,
} from "./infrastructure/experimentation-event-translator";
import { InMemoryExperimentRepository } from "./infrastructure/in-memory-experiment-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaExperimentRepository } from "./infrastructure/prisma-experiment-repository";
import { ExperimentationController } from "./interfaces/experimentation.controller";

export interface ExperimentationWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaExperimentRepository` +
   * `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.3): the repository
   * built here is a tenant-agnostic singleton — no `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredExperimentation {
  readonly experimentation: ExperimentationController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `ExperimentationController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  experiments: ExperimentRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ExperimentationWiringDeps,
): ExperimentationController {
  const experimentDeps = {
    experiments,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new ExperimentationController({
    createExperiment: new CreateExperiment(experimentDeps),
    advanceExperiment: new AdvanceExperiment(experimentDeps),
    recordResult: new RecordExperimentResult(experimentDeps),
    declareWinner: new DeclareWinner(experimentDeps),
    listExperiments: new ListExperiments({ experiments }),
    getExperiment: new GetExperiment({ experiments }),
  });
}

/**
 * Composition root for the Experimentation context. Prisma slice (`PrismaExperimentRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireExperimentation(deps: ExperimentationWiringDeps): WiredExperimentation {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ExperimentationEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "experiment",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time any more (see
    // ExperimentationWiringDeps' doc comment) — the repository built below takes tenantId per
    // call instead.
    const context = rootEventContext(deps.idGenerator);
    const experiments = new PrismaExperimentRepository({
      prisma: deps.prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      experimentation: buildController(experiments, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ExperimentationEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "experiment",
  });
  const context = rootEventContext(deps.idGenerator);

  const experiments = new InMemoryExperimentRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(experiments, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of EXPERIMENTATION_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    experimentation: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
