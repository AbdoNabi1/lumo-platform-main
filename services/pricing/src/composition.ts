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
import { ActivatePriceList } from "./application/activate-price-list.use-case";
import { ChangePrice } from "./application/change-price.use-case";
import { CreatePrice } from "./application/create-price.use-case";
import { CreatePriceList } from "./application/create-price-list.use-case";
import { CreatePricingRule } from "./application/create-pricing-rule.use-case";
import { CreateTaxClass } from "./application/create-tax-class.use-case";
import { ListPrices } from "./application/list-prices.use-case";
import { PublishPrice } from "./application/publish-price.use-case";
import type { PriceListRepository } from "./domain/price-list-repository";
import type { PriceRepository } from "./domain/price-repository";
import type { PricingRuleRepository } from "./domain/pricing-rule-repository";
import type { TaxClassRepository } from "./domain/tax-class-repository";
import { InMemoryPriceListRepository } from "./infrastructure/in-memory-price-list-repository";
import { InMemoryPriceRepository } from "./infrastructure/in-memory-price-repository";
import {
  InMemoryPricingRuleRepository,
  InMemoryTaxClassRepository,
} from "./infrastructure/in-memory-pricing-registry-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PricingEventTranslator } from "./infrastructure/pricing-event-translator";
import {
  PrismaPriceListRepository,
  PrismaPriceRepository,
} from "./infrastructure/prisma-pricing-repositories";
import {
  PrismaPricingRuleRepository,
  PrismaTaxClassRepository,
} from "./infrastructure/prisma-pricing-registry-repositories";
import { PriceListController } from "./interfaces/price-list.controller";
import { PriceController } from "./interfaces/price.controller";
import { RegistryController } from "./interfaces/registry.controller";

export interface PricingWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ all 4 Prisma repositories
   * (`PrismaPriceRepository`/`PrismaPriceListRepository`/`PrismaTaxClassRepository`/
   * `PrismaPricingRuleRepository`) + `PrismaUnitOfWork`; absent ⇒ in-memory, unchanged.
   * ADR-0014 (WP-10, T10.3): the repositories built here are tenant-agnostic singletons — no
   * `tenantId` at composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredPricing {
  readonly prices: PriceController;
  readonly priceLists: PriceListController;
  readonly registry: RegistryController;
  /**
   * The same `PriceRepository` instance `prices` above is built from (Phase 3 Task 9) — exposed so
   * a cross-context read adapter (e.g. Checkout's `PricingValidationPort`) can query published-
   * price data directly (`findPublishedByProduct`, H-1) without a second, state-disconnected
   * repository instance. Deliberately narrower than exposing the whole `PricingRepos` set: only
   * `prices` has a cross-context consumer today.
   */
  readonly priceRepository: PriceRepository;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface PricingRepos {
  readonly prices: PriceRepository;
  readonly priceLists: PriceListRepository;
  readonly taxClasses: TaxClassRepository;
  readonly pricingRules: PricingRuleRepository;
}

/** Builds all 3 controllers from an already-wired repo set — shared by both branches so the use-case wiring is written exactly once. */
function buildControllers(
  repos: PricingRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: PricingWiringDeps,
): { prices: PriceController; priceLists: PriceListController; registry: RegistryController } {
  const { prices, priceLists, taxClasses, pricingRules } = repos;
  const priceController = new PriceController({
    createPrice: new CreatePrice({ prices, unitOfWork, idGenerator: deps.idGenerator }),
    changePrice: new ChangePrice({
      prices,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    publishPrice: new PublishPrice({
      prices,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    listPrices: new ListPrices({ prices }),
  });
  const priceListController = new PriceListController({
    createPriceList: new CreatePriceList({ priceLists, unitOfWork, idGenerator: deps.idGenerator }),
    activatePriceList: new ActivatePriceList({ priceLists, unitOfWork }),
  });
  const registryController = new RegistryController({
    createTaxClass: new CreateTaxClass({
      taxClasses,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    createPricingRule: new CreatePricingRule({
      pricingRules,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
  });

  return { prices: priceController, priceLists: priceListController, registry: registryController };
}

/**
 * Composition root for the Pricing context. Prisma slice (all 4 repositories +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wirePricing(deps: PricingWiringDeps): WiredPricing {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new PricingEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "pricing",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time (see PricingWiringDeps) — every
    // repository takes it per call and merges it into the event context at write time.
    const context = rootEventContext(deps.idGenerator);
    const pricingDeps = { prisma: deps.prisma, outbox, context };
    const repos: PricingRepos = {
      prices: new PrismaPriceRepository(pricingDeps),
      priceLists: new PrismaPriceListRepository(pricingDeps),
      taxClasses: new PrismaTaxClassRepository(pricingDeps),
      pricingRules: new PrismaPricingRuleRepository(pricingDeps),
    };
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);
    const controllers = buildControllers(repos, unitOfWork, deps);

    return {
      ...controllers,
      priceRepository: repos.prices,
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new PricingEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "pricing",
  });
  const context = rootEventContext(deps.idGenerator);

  const repos: PricingRepos = {
    prices: new InMemoryPriceRepository({ outbox: outboxWriter, context }),
    priceLists: new InMemoryPriceListRepository({ outbox: outboxWriter, context }),
    taxClasses: new InMemoryTaxClassRepository({ outbox: outboxWriter, context }),
    pricingRules: new InMemoryPricingRuleRepository({ outbox: outboxWriter, context }),
  };
  const unitOfWork = new InMemoryUnitOfWork();
  const controllers = buildControllers(repos, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  bus.subscribe("pricing.price.changed.v1", sink);
  bus.subscribe("pricing.price.published.v1", sink);
  bus.subscribe("pricing.tax_class.created.v1", sink);
  bus.subscribe("pricing.pricing_rule.created.v1", sink);

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    ...controllers,
    priceRepository: repos.prices,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
