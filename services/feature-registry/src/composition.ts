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
  AdvanceFeature,
  AnalyzeCapabilityGraph,
  CreateBundle,
  DeclareDependencies,
  EditFeatureDraft,
  ListBundles,
  ListFeatures,
  RegisterFeature,
  ReplaceFeature,
  ResolveFeature,
  SetFeatureAiMetadata,
  SetFeatureCompatibility,
  SetFeatureGroups,
  SetFeatureMetadata,
  SetRequirements,
  UpdateBundle,
  ValidateRegistry,
  type FeatureBundleDeps,
  type FeatureRegistryDeps,
} from "./application/feature-registry.use-cases";
import type { FeatureBundleRepository, FeatureDefinitionRepository } from "./domain/repositories";
import {
  FeatureRegistryEventTranslator,
  FEATURE_REGISTRY_PUBLISHED_EVENTS,
} from "./infrastructure/feature-registry-event-translator";
import {
  InMemoryFeatureBundleRepository,
  InMemoryFeatureDefinitionRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaFeatureBundleRepository,
  PrismaFeatureDefinitionRepository,
} from "./infrastructure/prisma-repositories";
import { FeatureRegistryController } from "./interfaces/feature-registry.controller";

export interface FeatureRegistryWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (Phase 6 / G-39). Present ⇒ Prisma slice; absent ⇒ in-memory. ADR-0014
   * (WP-10, T10.5): the repositories built here are tenant-agnostic singletons — no `tenantId` at
   * composition time any more.
   */
  readonly prisma?: Database;
}

export interface WiredFeatureRegistry {
  readonly featureRegistry: FeatureRegistryController;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

function buildController(
  features: FeatureDefinitionRepository,
  bundles: FeatureBundleRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: FeatureRegistryWiringDeps,
): FeatureRegistryController {
  const base: FeatureRegistryDeps = {
    features,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const bundleBase: FeatureBundleDeps = {
    bundles,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  return new FeatureRegistryController({
    registerFeature: new RegisterFeature(base),
    editFeatureDraft: new EditFeatureDraft(base),
    declareDependencies: new DeclareDependencies(base),
    setRequirements: new SetRequirements(base),
    setFeatureGroups: new SetFeatureGroups(base),
    setFeatureCompatibility: new SetFeatureCompatibility(base),
    setFeatureAiMetadata: new SetFeatureAiMetadata(base),
    setFeatureMetadata: new SetFeatureMetadata(base),
    advanceFeature: new AdvanceFeature(base),
    replaceFeature: new ReplaceFeature(base),
    resolveFeature: new ResolveFeature(base),
    listFeatures: new ListFeatures(base),
    analyzeCapabilityGraph: new AnalyzeCapabilityGraph(base),
    createBundle: new CreateBundle(bundleBase),
    updateBundle: new UpdateBundle(bundleBase),
    listBundles: new ListBundles(bundleBase),
    validateRegistry: new ValidateRegistry({ features, bundles }),
  });
}

/** Composition root for the Feature Registry context. Prisma slice when `prisma` is present; else in-memory. */
export function wireFeatureRegistry(deps: FeatureRegistryWiringDeps): WiredFeatureRegistry {
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new FeatureRegistryEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "feature-registry",
    });
    const context = rootEventContext(deps.idGenerator);
    const repoDeps = { prisma: deps.prisma, outbox, context };
    const features = new PrismaFeatureDefinitionRepository(repoDeps);
    const bundles = new PrismaFeatureBundleRepository(repoDeps);
    return {
      featureRegistry: buildController(features, bundles, new PrismaUnitOfWork(deps.prisma), deps),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new FeatureRegistryEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "feature-registry",
  });
  const context = rootEventContext(deps.idGenerator);
  const inMemoryDeps = { outbox: outboxWriter, context };
  const features = new InMemoryFeatureDefinitionRepository(inMemoryDeps);
  const bundles = new InMemoryFeatureBundleRepository(inMemoryDeps);
  const controller = buildController(features, bundles, new InMemoryUnitOfWork(), deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const type of FEATURE_REGISTRY_PUBLISHED_EVENTS) bus.subscribe(`${type}.v1`, sink);
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    featureRegistry: controller,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
