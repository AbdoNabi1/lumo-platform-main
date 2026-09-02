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
import { GetRedirect } from "./application/get-redirect.use-case";
import { GetRobotsPolicy } from "./application/get-robots-policy.use-case";
import { GetSeoProfile } from "./application/get-seo-profile.use-case";
import { GetSitemap } from "./application/get-sitemap.use-case";
import { ListRedirects } from "./application/list-redirects.use-case";
import { ListRobotsPolicies } from "./application/list-robots-policies.use-case";
import { ListSeoProfiles } from "./application/list-seo-profiles.use-case";
import { ListSitemaps } from "./application/list-sitemaps.use-case";
import {
  CreateRedirect,
  CreateSitemap,
  RegenerateSitemap,
  SetRobotsPolicy,
  SetSeoProfile,
} from "./application/seo.use-cases";
import type {
  RedirectRepository,
  RobotsPolicyRepository,
  SeoProfileRepository,
  SitemapRepository,
} from "./domain/repositories";
import {
  InMemoryRedirectRepository,
  InMemoryRobotsPolicyRepository,
  InMemorySeoProfileRepository,
  InMemorySitemapRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaRedirectRepository,
  PrismaRobotsPolicyRepository,
  PrismaSeoProfileRepository,
  PrismaSitemapRepository,
} from "./infrastructure/prisma-repositories";
import { SEO_PUBLISHED_EVENTS, SeoEventTranslator } from "./infrastructure/seo-event-translator";
import { SeoController } from "./interfaces/seo.controller";

export interface SeoWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 4 Prisma repositories
   * (`PrismaSeoProfileRepository`/`PrismaRedirectRepository`/`PrismaSitemapRepository`/
   * `PrismaRobotsPolicyRepository`) + `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence
   * convention as `wireOrders`/`wireCatalog`); absent ⇒ in-memory, unchanged.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every SEO table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredSeo {
  readonly seo: SeoController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface SeoRepos {
  readonly profiles: SeoProfileRepository;
  readonly redirects: RedirectRepository;
  readonly sitemaps: SitemapRepository;
  readonly robotsPolicies: RobotsPolicyRepository;
}

/** Builds the `SeoController` from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  repos: SeoRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: SeoWiringDeps,
): SeoController {
  const seoDeps = {
    ...repos,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };

  return new SeoController({
    setSeoProfile: new SetSeoProfile(seoDeps),
    createRedirect: new CreateRedirect(seoDeps),
    createSitemap: new CreateSitemap(seoDeps),
    regenerateSitemap: new RegenerateSitemap(seoDeps),
    setRobotsPolicy: new SetRobotsPolicy(seoDeps),
    listSeoProfiles: new ListSeoProfiles({ profiles: repos.profiles }),
    getSeoProfile: new GetSeoProfile({ profiles: repos.profiles }),
    listRedirects: new ListRedirects({ redirects: repos.redirects }),
    getRedirect: new GetRedirect({ redirects: repos.redirects }),
    listSitemaps: new ListSitemaps({ sitemaps: repos.sitemaps }),
    getSitemap: new GetSitemap({ sitemaps: repos.sitemaps }),
    listRobotsPolicies: new ListRobotsPolicies({ robotsPolicies: repos.robotsPolicies }),
    getRobotsPolicy: new GetRobotsPolicy({ robotsPolicies: repos.robotsPolicies }),
  });
}

/**
 * Composition root for the SEO context. Prisma slice (all 4 repositories + `PrismaUnitOfWork`)
 * when `prisma` is present; else in-memory.
 */
export function wireSeo(deps: SeoWiringDeps): WiredSeo {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireSeo: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new SeoEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "seo",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const seoDeps = { prisma: deps.prisma, tenantId, outbox, context };
    const repos: SeoRepos = {
      profiles: new PrismaSeoProfileRepository(seoDeps),
      redirects: new PrismaRedirectRepository(seoDeps),
      sitemaps: new PrismaSitemapRepository(seoDeps),
      robotsPolicies: new PrismaRobotsPolicyRepository(seoDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      seo: buildController(repos, unitOfWork, deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new SeoEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "seo",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: SeoRepos = {
    profiles: new InMemorySeoProfileRepository({ outbox: outboxWriter, context }),
    redirects: new InMemoryRedirectRepository({ outbox: outboxWriter, context }),
    sitemaps: new InMemorySitemapRepository({ outbox: outboxWriter, context }),
    robotsPolicies: new InMemoryRobotsPolicyRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of SEO_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    seo: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
