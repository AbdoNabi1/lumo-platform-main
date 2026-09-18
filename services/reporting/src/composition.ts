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
import { GetDashboard } from "./application/get-dashboard.use-case";
import { GetReportDefinition } from "./application/get-report-definition.use-case";
import { ListDashboards } from "./application/list-dashboards.use-case";
import { ListReportDefinitions } from "./application/list-report-definitions.use-case";
import type { AnalyticsQueryPort } from "./application/ports";
import {
  AdvanceDashboard,
  AdvanceReportDefinition,
  CreateDashboard,
  CreateReportDefinition,
  GenerateReport,
} from "./application/reporting.use-cases";
import type {
  AnalyticsReportRepository,
  DashboardRepository,
  ReportDefinitionRepository,
} from "./domain/repositories";
import { InMemoryAnalyticsQuery } from "./infrastructure/in-memory-analytics-query";
import {
  InMemoryAnalyticsReportRepository,
  InMemoryDashboardRepository,
  InMemoryReportDefinitionRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaAnalyticsReportRepository,
  PrismaDashboardRepository,
  PrismaReportDefinitionRepository,
} from "./infrastructure/prisma-repositories";
import {
  REPORTING_PUBLISHED_EVENTS,
  ReportingEventTranslator,
} from "./infrastructure/reporting-event-translator";
import { ReportingController } from "./interfaces/reporting.controller";

export interface ReportingWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Defaults to the in-memory stub until a real adapter onto `@platform/analytics` is wired (deferred, G-39). */
  readonly analytics?: AnalyticsQueryPort;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 3 Prisma repositories
   * (`PrismaReportDefinitionRepository`/`PrismaDashboardRepository`/`PrismaAnalyticsReportRepository`)
   * + `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged. ADR-0014 (WP-10, T10.3): the repositories
   * built here are tenant-agnostic singletons — no `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredReporting {
  readonly reporting: ReportingController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface ReportingRepos {
  readonly reportDefinitions: ReportDefinitionRepository;
  readonly dashboards: DashboardRepository;
  readonly analyticsReports: AnalyticsReportRepository;
}

/** Builds the `ReportingController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: ReportingRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: ReportingWiringDeps,
): ReportingController {
  const analytics = deps.analytics ?? new InMemoryAnalyticsQuery();

  const reportingDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new ReportingController({
    createReportDefinition: new CreateReportDefinition(reportingDeps),
    advanceReportDefinition: new AdvanceReportDefinition(reportingDeps),
    generateReport: new GenerateReport({ ...reportingDeps, analytics }),
    createDashboard: new CreateDashboard(reportingDeps),
    advanceDashboard: new AdvanceDashboard(reportingDeps),
    listReportDefinitions: new ListReportDefinitions(reportingDeps),
    getReportDefinition: new GetReportDefinition(reportingDeps),
    listDashboards: new ListDashboards(reportingDeps),
    getDashboard: new GetDashboard(reportingDeps),
  });
}

/**
 * Composition root for the Reporting context. Prisma slice (all 3 repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireReporting(deps: ReportingWiringDeps): WiredReporting {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new ReportingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "reporting",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time (see ReportingWiringDeps) — every
    // repository takes it per call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const reportingDeps = { prisma: deps.prisma, outbox, context };
    const repos: ReportingRepos = {
      reportDefinitions: new PrismaReportDefinitionRepository(reportingDeps),
      dashboards: new PrismaDashboardRepository(reportingDeps),
      analyticsReports: new PrismaAnalyticsReportRepository(reportingDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      reporting: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new ReportingEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "reporting",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: ReportingRepos = {
    reportDefinitions: new InMemoryReportDefinitionRepository({ outbox: outboxWriter, context }),
    dashboards: new InMemoryDashboardRepository({ outbox: outboxWriter, context }),
    analyticsReports: new InMemoryAnalyticsReportRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of REPORTING_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    reporting: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
