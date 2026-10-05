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
import type { DnsVerifier } from "./domain/dns-verifier";
import { GetCurrentWorkspace } from "./application/get-current-workspace.use-case";
import { GetTenant } from "./application/get-tenant.use-case";
import { GetWorkspace } from "./application/get-workspace.use-case";
import { ListTenants } from "./application/list-tenants.use-case";
import { ListWorkspaces } from "./application/list-workspaces.use-case";
import {
  AddCustomDomain,
  ListShopDomains,
  ResolveHost,
  SetPrimaryDomain,
  VerifyDomain,
} from "./application/shop-domains.use-cases";
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
import type {
  ShopDomainRepository,
  TenantRepository,
  WorkspaceRepository,
} from "./domain/repositories";
import {
  InMemoryShopDomainRepository,
  InMemoryTenantRepository,
  InMemoryWorkspaceRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaShopDomainRepository,
  PrismaTenantRepository,
  PrismaWorkspaceRepository,
} from "./infrastructure/prisma-repositories";
import {
  TENANCY_PUBLISHED_EVENTS,
  TenancyEventTranslator,
} from "./infrastructure/tenancy-event-translator";
import { TenancyController } from "./interfaces/tenancy.controller";

/** Envelope tenant for the in-memory composition when the caller supplies none (never a deployment default). */
export const IN_MEMORY_TENANT_ID = "tenant-in-memory";

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
  /** T10.6: tenant ids the ordinary lifecycle refuses to suspend/cancel (the platform tenant). */
  readonly protectedTenantIds?: readonly string[];
  /** Plan 1A: e.g. `morbeh.store`; new shops get `<slug>.<this>`. Absent ⇒ no automatic subdomain. */
  readonly platformStoreDomain?: string;
  /** Plan 1A: absent ⇒ custom domains cannot be verified. */
  readonly dnsVerifier?: DnsVerifier;
}

/** A tenant's lifecycle status as the request boundary needs it; `unknown` = no such tenant row. */
export type TenantAvailability = "active" | "suspended" | "cancelled" | "unknown";

export interface WiredTenancy {
  readonly tenancy: TenancyController;
  /** Reads one tenant's status from the source of truth (no caching — the caller owns that). */
  readonly tenantAvailability: (tenantId: string) => Promise<TenantAvailability>;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface TenancyRepos {
  readonly tenants: TenantRepository;
  readonly workspaces: WorkspaceRepository;
  readonly domains: ShopDomainRepository;
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
    ...(deps.protectedTenantIds === undefined
      ? {}
      : { protectedTenantIds: deps.protectedTenantIds }),
    ...(deps.platformStoreDomain === undefined
      ? {}
      : { platformStoreDomain: deps.platformStoreDomain }),
    ...(deps.dnsVerifier === undefined ? {} : { dnsVerifier: deps.dnsVerifier }),
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
    addCustomDomain: new AddCustomDomain(tenancyDeps),
    verifyDomain: new VerifyDomain(tenancyDeps),
    setPrimaryDomain: new SetPrimaryDomain(tenancyDeps),
    listShopDomains: new ListShopDomains(tenancyDeps),
    resolveHost: new ResolveHost(tenancyDeps),
  });
}

function availabilityOf(tenants: TenantRepository): WiredTenancy["tenantAvailability"] {
  return async (tenantId) => {
    const tenant = await tenants.findById(tenantId);
    return tenant === null ? "unknown" : tenant.status;
  };
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
      domains: new PrismaShopDomainRepository(tenancyDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      tenancy: buildController(repos, unitOfWork, deps),
      tenantAvailability: availabilityOf(repos.tenants),
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
  // The in-memory composition (dev/tests) has no deployment tenant; the outbox requires one on every
  // envelope (G-64), so it is the caller's when given, else an explicit in-memory marker.
  const context = rootEventContext(deps.idGenerator, deps.tenantId ?? IN_MEMORY_TENANT_ID);

  const repos: TenancyRepos = {
    tenants: new InMemoryTenantRepository({ outbox: outboxWriter, context }),
    workspaces: new InMemoryWorkspaceRepository({ outbox: outboxWriter, context }),
    domains: new InMemoryShopDomainRepository(),
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
    tenantAvailability: availabilityOf(repos.tenants),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
