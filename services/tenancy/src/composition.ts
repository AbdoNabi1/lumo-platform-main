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
import { GetCurrentWorkspace } from "./application/get-current-workspace.use-case";
import { GetTenant } from "./application/get-tenant.use-case";
import { GetWorkspace } from "./application/get-workspace.use-case";
import { ListTenants } from "./application/list-tenants.use-case";
import { ListWorkspaces } from "./application/list-workspaces.use-case";
import {
  ActivateTenant,
  ArchiveWorkspace,
  CancelTenant,
  ConfigureWorkspace,
  CreateTenant,
  CreateWorkspace,
  RebrandTenant,
  SuspendTenant,
} from "./application/tenancy.use-cases";
import type { TenantRepository, WorkspaceRepository } from "./domain/repositories";
import {
  InMemoryTenantRepository,
  InMemoryWorkspaceRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaTenantRepository,
  PrismaWorkspaceRepository,
} from "./infrastructure/prisma-repositories";
import {
  TENANCY_PUBLISHED_EVENTS,
  TenancyEventTranslator,
} from "./infrastructure/tenancy-event-translator";
import { TenancyController } from "./interfaces/tenancy.controller";

export interface TenancyWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaTenantRepository` +
   * `PrismaWorkspaceRepository` + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wireMediaLibrary`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Tenancy table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredTenancy {
  readonly tenancy: TenancyController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface TenancyRepos {
  readonly tenants: TenantRepository;
  readonly workspaces: WorkspaceRepository;
}

/** Builds the `TenancyController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: TenancyRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: TenancyWiringDeps,
): TenancyController {
  const tenancyDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new TenancyController({
    createTenant: new CreateTenant(tenancyDeps),
    activateTenant: new ActivateTenant(tenancyDeps),
    suspendTenant: new SuspendTenant(tenancyDeps),
    cancelTenant: new CancelTenant(tenancyDeps),
    rebrandTenant: new RebrandTenant(tenancyDeps),
    createWorkspace: new CreateWorkspace(tenancyDeps),
    archiveWorkspace: new ArchiveWorkspace(tenancyDeps),
    configureWorkspace: new ConfigureWorkspace(tenancyDeps),
    listTenants: new ListTenants({ tenants: repos.tenants }),
    getTenant: new GetTenant({ tenants: repos.tenants }),
    listWorkspaces: new ListWorkspaces({ workspaces: repos.workspaces }),
    getWorkspace: new GetWorkspace({ workspaces: repos.workspaces }),
    getCurrentWorkspace: new GetCurrentWorkspace({ workspaces: repos.workspaces }),
  });
}

/**
 * Composition root for the Tenancy context. Prisma slice (both repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireTenancy(deps: TenancyWiringDeps): WiredTenancy {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireTenancy: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new TenancyEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "tenancy",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const tenancyDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: TenancyRepos = {
      tenants: new PrismaTenantRepository(tenancyDeps),
      workspaces: new PrismaWorkspaceRepository(tenancyDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      tenancy: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new TenancyEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "tenancy",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: TenancyRepos = {
    tenants: new InMemoryTenantRepository({ outbox: outboxWriter, context }),
    workspaces: new InMemoryWorkspaceRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of TENANCY_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    tenancy: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
