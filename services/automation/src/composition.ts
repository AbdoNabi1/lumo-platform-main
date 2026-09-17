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
  AdvanceWorkflow,
  CreateWorkflow,
  ListWorkflows,
  RetryExecution,
  TriggerWorkflow,
} from "./application/automation.use-cases";
import type { ActionDispatcherPort } from "./application/ports";
import type { AutomationWorkflowRepository } from "./domain/automation-workflow-repository";
import {
  AUTOMATION_PUBLISHED_EVENTS,
  AutomationEventTranslator,
} from "./infrastructure/automation-event-translator";
import { InMemoryAutomationWorkflowRepository } from "./infrastructure/in-memory-automation-workflow-repository";
import { InMemoryActionDispatcher } from "./infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaAutomationWorkflowRepository } from "./infrastructure/prisma-automation-workflow-repository";
import { AutomationController } from "./interfaces/automation.controller";

export interface AutomationWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub until a real cross-context dispatcher is wired (deferred, G-39). */
  readonly dispatcher?: ActionDispatcherPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaAutomationWorkflowRepository` +
   * `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.5): the repository
   * built here is a tenant-agnostic singleton — no `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredAutomation {
  readonly automation: AutomationController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `AutomationController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  workflows: AutomationWorkflowRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: AutomationWiringDeps,
): AutomationController {
  const dispatcher = deps.dispatcher ?? new InMemoryActionDispatcher();

  const workflowDeps = { workflows, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new AutomationController({
    createWorkflow: new CreateWorkflow(workflowDeps),
    advanceWorkflow: new AdvanceWorkflow(workflowDeps),
    triggerWorkflow: new TriggerWorkflow({ ...workflowDeps, dispatcher }),
    retryExecution: new RetryExecution(workflowDeps),
    listWorkflows: new ListWorkflows({ workflows }),
  });
}

/**
 * Composition root for the Automation context. Prisma slice
 * (`PrismaAutomationWorkflowRepository` + `PrismaUnitOfWork`) when `prisma` is present; else
 * in-memory.
 */
export function wireAutomation(deps: AutomationWiringDeps): WiredAutomation {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new AutomationEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "automation",
    });
    const context = rootEventContext(deps.idGenerator);
    const workflows = new PrismaAutomationWorkflowRepository({
      prisma: deps.prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      automation: buildController(workflows, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new AutomationEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "automation",
  });
  const context = rootEventContext(deps.idGenerator);

  const workflows = new InMemoryAutomationWorkflowRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(workflows, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of AUTOMATION_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    automation: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
