import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import type { FeatureFlags } from "@platform/feature-flags";
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
  AddFeatureRule,
  AdvanceFlag,
  CreateFeatureFlag,
  SetEnvironmentOverride,
  SetRolloutPercentage,
} from "./application/feature-flag.use-cases";
import { GetFeatureFlag } from "./application/get-feature-flag.use-case";
import { ListFeatureFlags } from "./application/list-feature-flags.use-case";
import type { FeatureFlagRepository } from "./domain/feature-flag-repository";
import { AggregateFeatureFlags } from "./infrastructure/aggregate-feature-flags";
import {
  FEATURE_FLAGS_PUBLISHED_EVENTS,
  FeatureFlagsEventTranslator,
} from "./infrastructure/feature-flags-event-translator";
import { InMemoryFeatureFlagRepository } from "./infrastructure/in-memory-feature-flag-repository";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaFeatureFlagRepository } from "./infrastructure/prisma-feature-flag-repository";
import { FeatureFlagsController } from "./interfaces/feature-flags.controller";

export interface FeatureFlagsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * Production persistence (G-39/C-01). Present ⇒ `PrismaFeatureFlagRepository` +
   * `PrismaUnitOfWork` (same `prisma?`/`tenantId?`-presence convention as `wireOrders`/
   * `wireExperimentation`); absent ⇒ in-memory, unchanged. `evaluator` wraps whichever repository
   * is actually wired, in both branches.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Feature Flags table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredFeatureFlags {
  readonly featureFlags: FeatureFlagsController;
  /** The production `FeatureFlags` contract implementation (`@platform/feature-flags`) — this is what other contexts should be wired against. */
  readonly evaluator: FeatureFlags;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Builds the `FeatureFlagsController` from an already-wired repo + unit of work — shared by both branches so the use-case wiring is written exactly once. */
function buildController(
  flags: FeatureFlagRepository,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  deps: FeatureFlagsWiringDeps,
): FeatureFlagsController {
  const flagDeps = { flags, unitOfWork, idGenerator: deps.idGenerator, clock: deps.clock };

  return new FeatureFlagsController({
    createFlag: new CreateFeatureFlag(flagDeps),
    advanceFlag: new AdvanceFlag(flagDeps),
    setRolloutPercentage: new SetRolloutPercentage(flagDeps),
    addRule: new AddFeatureRule(flagDeps),
    setEnvironmentOverride: new SetEnvironmentOverride(flagDeps),
    listFeatureFlags: new ListFeatureFlags({ flags }),
    getFeatureFlag: new GetFeatureFlag({ flags }),
  });
}

/**
 * Composition root for the Feature Flags context. Prisma slice (`PrismaFeatureFlagRepository` +
 * `PrismaUnitOfWork`) when `prisma` is present; else in-memory.
 */
export function wireFeatureFlags(deps: FeatureFlagsWiringDeps): WiredFeatureFlags {
  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireFeatureFlags: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new FeatureFlagsEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "feature_flags",
    });
    // ADR-0014, WP-10 T10.3: no tenantId at composition time for repository construction any
    // more — PrismaFeatureFlagRepository takes tenantId per call. `tenantId` itself is still
    // needed below for AggregateFeatureFlags (the kernel FeatureFlags port has no tenant concept
    // to thread it through per-call — see AggregateFeatureFlagsDeps' own doc comment).
    const context = rootEventContext(deps.idGenerator);
    const flags = new PrismaFeatureFlagRepository({ prisma: deps.prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(deps.prisma);

    return {
      featureFlags: buildController(flags, unitOfWork, deps),
      evaluator: new AggregateFeatureFlags({ flags, tenantId }),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new FeatureFlagsEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "feature_flags",
  });
  const context = rootEventContext(deps.idGenerator);

  const flags = new InMemoryFeatureFlagRepository({ outbox: outboxWriter, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(flags, unitOfWork, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const eventType of FEATURE_FLAGS_PUBLISHED_EVENTS) {
    bus.subscribe(`${eventType}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    featureFlags: controller,
    // ADR-0014: the in-memory path has no real tenant concept (InMemoryFeatureFlagRepository
    // ignores tenantId entirely) — a fixed placeholder is harmless here, unlike the Prisma path.
    evaluator: new AggregateFeatureFlags({ flags, tenantId: "tenant-local" }),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
