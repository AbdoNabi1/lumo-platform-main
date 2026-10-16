import type { Clock, IdGenerator } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { GetIdentityTimeline } from "./application/get-identity-timeline.use-case";
import { GetCustomerProfile } from "./application/get-customer-profile.use-case";
import { MergeIdentities } from "./application/merge-identities.use-case";
import { ObserveIdentityLink } from "./application/observe-identity-link.use-case";
import { ProfileProjectionWorker } from "./application/profile-projection-worker";
import { RebuildProfileProjection } from "./application/rebuild-profile-projection.use-case";
import { ResolveIdentity } from "./application/resolve-identity.use-case";
import { SplitIdentity } from "./application/split-identity.use-case";
import { UpdateProfileProjection } from "./application/update-profile-projection.use-case";
import { CloseSession } from "./application/close-session.use-case";
import { GetJourneyState } from "./application/get-journey-state.use-case";
import { GetJourneyTimeline } from "./application/get-journey-timeline.use-case";
import { MergeSession } from "./application/merge-session.use-case";
import { ObserveSession } from "./application/observe-session.use-case";
import { RebuildSessions } from "./application/rebuild-sessions.use-case";
import { ResolveCurrentSession } from "./application/resolve-current-session.use-case";
import { ResumeSession } from "./application/resume-session.use-case";
import { SessionProjectionWorker } from "./application/session-projection-worker";
import { SplitSession } from "./application/split-session.use-case";
import { ComputedAttributeProjectionWorker } from "./application/computed-attribute-projection-worker";
import { EvaluateAttributeGraph } from "./application/evaluate-attribute-graph.use-case";
import { EvaluateComputedAttribute } from "./application/evaluate-computed-attribute.use-case";
import { GetComputedAttributes } from "./application/get-computed-attributes.use-case";
import { RebuildComputedAttributes } from "./application/rebuild-computed-attributes.use-case";
import { RecalculateComputedAttributes } from "./application/recalculate-computed-attributes.use-case";
import { UpdateComputedAttributeProjection } from "./application/update-computed-attribute-projection.use-case";
import { CreateSegment } from "./application/create-segment.use-case";
import { UpdateSegment } from "./application/update-segment.use-case";
import { DeleteSegment } from "./application/delete-segment.use-case";
import { EvaluateSegment } from "./application/evaluate-segment.use-case";
import { EvaluateAllSegments } from "./application/evaluate-all-segments.use-case";
import { UpdateSegmentMembershipProjection } from "./application/update-segment-membership-projection.use-case";
import { RecalculateMemberships } from "./application/recalculate-memberships.use-case";
import { RebuildSegmentMembership } from "./application/rebuild-segment-membership.use-case";
import { GetSegmentMembers } from "./application/get-segment-members.use-case";
import { GetCustomerSegments } from "./application/get-customer-segments.use-case";
import { SegmentProjectionWorker } from "./application/segment-projection-worker";
import { SegmentMembershipWorker } from "./application/segment-membership-worker";
import { Customer360Controller } from "./interfaces/customer-360.controller";
import { IdentityEventTranslator } from "./infrastructure/identity-event-translator";
import { InMemoryAttributeDefinitionRegistry } from "./infrastructure/in-memory-attribute-definition-registry";
import { InMemoryAttributeHistoryStore } from "./infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "./infrastructure/in-memory-attribute-store";
import { InMemoryIdentityDecisionStore } from "./infrastructure/in-memory-identity-decision-store";
import { InMemoryIdentityGraphStore } from "./infrastructure/in-memory-identity-graph-store";
import { InMemoryJourneyStore } from "./infrastructure/in-memory-journey-store";
import { InMemoryProfileHistoryStore } from "./infrastructure/in-memory-profile-history-store";
import { InMemoryProfileStore } from "./infrastructure/in-memory-profile-store";
import { InMemorySegmentDefinitionRegistry } from "./infrastructure/in-memory-segment-definition-registry";
import { InMemorySegmentHistoryStore } from "./infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "./infrastructure/in-memory-segment-store";
import { InMemorySessionHistoryStore } from "./infrastructure/in-memory-session-history-store";
import { InMemorySessionStore } from "./infrastructure/in-memory-session-store";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import { PrismaAttributeDefinitionRegistry } from "./infrastructure/prisma-attribute-definition-registry";
import { PrismaAttributeHistoryStore } from "./infrastructure/prisma-attribute-history-store";
import { PrismaAttributeStore } from "./infrastructure/prisma-attribute-store";
import { PrismaIdentityDecisionStore } from "./infrastructure/prisma-identity-decision-store";
import { PrismaIdentityGraphStore } from "./infrastructure/prisma-identity-graph-store";
import { PrismaJourneyStore } from "./infrastructure/prisma-journey-store";
import { PrismaProfileHistoryStore } from "./infrastructure/prisma-profile-history-store";
import { PrismaProfileStore } from "./infrastructure/prisma-profile-store";
import { PrismaSegmentDefinitionRegistry } from "./infrastructure/prisma-segment-definition-registry";
import { PrismaSegmentHistoryStore } from "./infrastructure/prisma-segment-history-store";
import { PrismaSegmentStore } from "./infrastructure/prisma-segment-store";
import { PrismaSessionHistoryStore } from "./infrastructure/prisma-session-history-store";
import { PrismaSessionStore } from "./infrastructure/prisma-session-store";
import type { AttributeDefinitionRegistry } from "./ports/attribute-definition-registry";
import type { AttributeHistoryStore } from "./ports/attribute-history-store";
import type { AttributeStore } from "./ports/attribute-store";
import type { ComputedAttributeDefinition } from "./ports/computed-attribute-definition";
import type { IdentityDecisionStore } from "./ports/identity-decision-store";
import type { IdentityGraphStore } from "./ports/identity-graph-store";
import type { JourneyStore } from "./ports/journey-store";
import type { ProfileHistoryStore } from "./ports/profile-history-store";
import type { ProfileStore } from "./ports/profile-store";
import type { SegmentDefinition } from "./ports/segment-definition";
import type { SegmentDefinitionRegistry } from "./ports/segment-definition-registry";
import type { SegmentHistoryStore } from "./ports/segment-history-store";
import type { SegmentStore } from "./ports/segment-store";
import type { SessionHistoryStore } from "./ports/session-history-store";
import type { SessionStore } from "./ports/session-store";
import type { TenantSeed } from "./infrastructure/tenant-seed";

export interface Customer360WiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Production persistence (Phase 9 hardening / G-39-adjacent). Present ⇒ Prisma slice across all
   * five engines (Identity/Profile/Session/Computed-Attribute/Segment); absent ⇒ in-memory. Mirrors
   * `wireIdentity`/`wireFinance`'s own `prisma`-presence branch exactly — same convention, same
   * package (`@platform/db`'s `Database`). */
  readonly prisma?: Database;
  /** Seeds the in-memory `AttributeDefinitionRegistry` (Phase 6.4) — definitions are authored
   * configuration, not something this composition root invents, so an empty registry (the default)
   * is a perfectly valid wiring with nothing yet to evaluate. Dev/test-only: the Prisma registry is
   * seed-script-populated (see `PrismaAttributeDefinitionRegistry`'s own doc), never seeded here. */
  readonly computedAttributeDefinitions?: TenantSeed<ComputedAttributeDefinition>;
  /** Seeds the in-memory `SegmentDefinitionRegistry` (Phase 6.5) — unlike
   * `computedAttributeDefinitions`, this registry stays mutable at runtime via `CreateSegment`/
   * `UpdateSegment`/`DeleteSegment`; the seed is only a starting point, not the whole story.
   * Dev/test-only, same reasoning as `computedAttributeDefinitions` above. */
  readonly segmentDefinitions?: TenantSeed<SegmentDefinition>;
}

export interface WiredCustomer360 {
  /** Framework-agnostic read-side facade (Phase 8.1 gap-only addition) wrapping the four read
   * use-cases below (`getIdentityTimeline`/`getCustomerProfile`/`getJourneyTimeline`/`getJourneyState`)
   * behind the same Controller+`present()` boundary every other context already has. */
  readonly customer360: Customer360Controller;
  readonly observeIdentityLink: ObserveIdentityLink;
  readonly resolveIdentity: ResolveIdentity;
  readonly mergeIdentities: MergeIdentities;
  readonly splitIdentity: SplitIdentity;
  readonly getIdentityTimeline: GetIdentityTimeline;
  /** Phase 6.2 — Profile Engine. Same package, same composition root, same outbox/unit-of-work as
   * the Identity Engine above (extends the context per D-058/context-map row 35, not a new one). */
  readonly getCustomerProfile: GetCustomerProfile;
  readonly updateProfileProjection: UpdateProfileProjection;
  readonly rebuildProfileProjection: RebuildProfileProjection;
  readonly profileProjectionWorker: ProfileProjectionWorker;
  /** Phase 6.3 — Session Stitching Engine. Same package, same composition root, same outbox/unit-of-
   * work as the Identity + Profile Engines above (extends the context per D-058/context-map row 35,
   * not a new one). Reuses `resolveIdentity` above for cross-device "current session" resolution —
   * never a second identity-stitching implementation. */
  readonly observeSession: ObserveSession;
  readonly closeSession: CloseSession;
  readonly resumeSession: ResumeSession;
  readonly splitSession: SplitSession;
  readonly mergeSession: MergeSession;
  readonly resolveCurrentSession: ResolveCurrentSession;
  readonly rebuildSessions: RebuildSessions;
  readonly sessionProjectionWorker: SessionProjectionWorker;
  readonly getJourneyTimeline: GetJourneyTimeline;
  readonly getJourneyState: GetJourneyState;
  /** Phase 6.4 — Computed Attributes Engine. Same package, same composition root, same outbox/
   * unit-of-work as the three engines above (extends the context per D-058/context-map row 35, not
   * a new one). Reuses `getCustomerProfile`/`getJourneyState` above to build each evaluation's
   * context and `resolveIdentity` for its own read model's cluster merge — never a second read path
   * over facts this package already assembles. */
  readonly evaluateComputedAttribute: EvaluateComputedAttribute;
  readonly evaluateAttributeGraph: EvaluateAttributeGraph;
  readonly recalculateComputedAttributes: RecalculateComputedAttributes;
  readonly updateComputedAttributeProjection: UpdateComputedAttributeProjection;
  readonly rebuildComputedAttributes: RebuildComputedAttributes;
  readonly getComputedAttributes: GetComputedAttributes;
  readonly computedAttributeProjectionWorker: ComputedAttributeProjectionWorker;
  /** Phase 6.5 — Segmentation Engine. Same package, same composition root, same outbox/unit-of-work
   * as the four engines above (extends the context per D-058/context-map row 35, not a new one).
   * Reuses `getCustomerProfile`/`getJourneyState`/`getComputedAttributes`/`resolveIdentity` above to
   * build each evaluation's context and its own read model's cluster merge — never a second read path
   * or a second dependency-graph implementation (incremental recompute reuses `dependentsOf` from
   * Phase 6.4's `domain/attribute-dependency.ts` verbatim). Unlike the read-only
   * `AttributeDefinitionRegistry`, `SegmentDefinitionRegistry` is read-write. */
  readonly createSegment: CreateSegment;
  readonly updateSegment: UpdateSegment;
  readonly deleteSegment: DeleteSegment;
  readonly evaluateSegment: EvaluateSegment;
  readonly evaluateAllSegments: EvaluateAllSegments;
  readonly updateSegmentMembershipProjection: UpdateSegmentMembershipProjection;
  readonly recalculateMemberships: RecalculateMemberships;
  readonly rebuildSegmentMembership: RebuildSegmentMembership;
  readonly getSegmentMembers: GetSegmentMembers;
  readonly getCustomerSegments: GetCustomerSegments;
  readonly segmentProjectionWorker: SegmentProjectionWorker;
  readonly segmentMembershipWorker: SegmentMembershipWorker;
  /** Drains the outbox once (relay → publisher); returns the number published. In-memory slice
   * only — the Prisma slice's outbox is drained by the platform's CDC/Debezium relay, same
   * convention as `wireIdentity`/`wireFinance` (returns a no-op resolving to 0). */
  readonly drainOutbox: () => Promise<number>;
}

/** The full set of per-engine store/registry ports the use-case layer is wired against, common to
 * both the in-memory and Prisma slices — factored out so the (large) use-case wiring below is
 * written exactly once, per Rule 2 (zero duplication), rather than once per persistence slice. */
interface Customer360Stores {
  readonly graph: IdentityGraphStore;
  readonly decisions: IdentityDecisionStore;
  readonly profiles: ProfileStore;
  readonly profileHistory: ProfileHistoryStore;
  readonly sessions: SessionStore;
  readonly sessionHistory: SessionHistoryStore;
  readonly journey: JourneyStore;
  readonly computedAttributes: AttributeStore;
  readonly attributeHistory: AttributeHistoryStore;
  readonly attributeDefinitions: AttributeDefinitionRegistry;
  readonly segments: SegmentStore;
  readonly segmentHistory: SegmentHistoryStore;
  readonly segmentDefinitions: SegmentDefinitionRegistry;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/**
 * Wires domain → application → stores (for whichever persistence slice the caller built) → the
 * shared read/write facades, identically for the in-memory and Prisma paths. Extracted so
 * `wireCustomer360` never has two copies of ~35 use-case constructions to keep in sync (the exact
 * failure mode Rule 2 / Rule 14 exist to prevent).
 */
function buildWiredCustomer360(
  deps: Customer360WiringDeps,
  stores: Customer360Stores,
  drainOutbox: () => Promise<number>,
): WiredCustomer360 {
  const {
    graph,
    decisions,
    profiles,
    profileHistory,
    sessions,
    sessionHistory,
    journey,
    computedAttributes,
    attributeHistory,
    attributeDefinitions,
    segments,
    segmentHistory,
    segmentDefinitions,
    unitOfWork,
  } = stores;

  const resolveIdentity = new ResolveIdentity({
    graph,
    decisions,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const rebuildProfileProjection = new RebuildProfileProjection({
    profiles,
    history: profileHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const sessionRebuild = new RebuildSessions({
    sessions,
    history: sessionHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const getCustomerProfile = new GetCustomerProfile({ profiles, resolveIdentity });
  const getJourneyState = new GetJourneyState({ sessions, journey });
  const getIdentityTimeline = new GetIdentityTimeline({ graph, decisions });
  const getJourneyTimeline = new GetJourneyTimeline({ sessions, history: sessionHistory, journey });

  const evaluateComputedAttribute = new EvaluateComputedAttribute({
    getCustomerProfile,
    getJourneyState,
    attributes: computedAttributes,
    clock: deps.clock,
  });
  const updateComputedAttributeProjection = new UpdateComputedAttributeProjection({
    attributes: computedAttributes,
    history: attributeHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const evaluateAttributeGraph = new EvaluateAttributeGraph({
    evaluate: evaluateComputedAttribute,
    updateProjection: updateComputedAttributeProjection,
  });
  const rebuildComputedAttributes = new RebuildComputedAttributes({
    attributes: computedAttributes,
    history: attributeHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });

  const evaluateSegment = new EvaluateSegment({
    getCustomerProfile,
    getJourneyState,
    getComputedAttributes: new GetComputedAttributes({
      attributes: computedAttributes,
      resolveIdentity,
    }),
    clock: deps.clock,
  });
  const updateSegmentMembershipProjection = new UpdateSegmentMembershipProjection({
    segments,
    history: segmentHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });
  const evaluateAllSegments = new EvaluateAllSegments({
    evaluate: evaluateSegment,
    updateProjection: updateSegmentMembershipProjection,
  });
  const rebuildSegmentMembership = new RebuildSegmentMembership({
    segments,
    history: segmentHistory,
    unitOfWork,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });

  return {
    customer360: new Customer360Controller({
      getCustomerProfile,
      getIdentityTimeline,
      getJourneyTimeline,
      getJourneyState,
      clock: deps.clock,
    }),
    observeIdentityLink: new ObserveIdentityLink({
      graph,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    resolveIdentity,
    mergeIdentities: new MergeIdentities({
      graph,
      decisions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    splitIdentity: new SplitIdentity({
      graph,
      decisions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    getIdentityTimeline,
    getCustomerProfile,
    updateProfileProjection: new UpdateProfileProjection({
      profiles,
      history: profileHistory,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    rebuildProfileProjection,
    profileProjectionWorker: new ProfileProjectionWorker({
      profiles,
      rebuild: rebuildProfileProjection,
    }),
    observeSession: new ObserveSession({
      sessions,
      history: sessionHistory,
      journey,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    closeSession: new CloseSession({
      sessions,
      history: sessionHistory,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    resumeSession: new ResumeSession({
      sessions,
      history: sessionHistory,
      journey,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    splitSession: new SplitSession({
      sessions,
      history: sessionHistory,
      journey,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    mergeSession: new MergeSession({
      sessions,
      journey,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    resolveCurrentSession: new ResolveCurrentSession({ sessions, resolveIdentity }),
    rebuildSessions: sessionRebuild,
    sessionProjectionWorker: new SessionProjectionWorker({ sessions, rebuild: sessionRebuild }),
    getJourneyTimeline,
    getJourneyState,
    evaluateComputedAttribute,
    evaluateAttributeGraph,
    recalculateComputedAttributes: new RecalculateComputedAttributes({
      definitions: attributeDefinitions,
      evaluateGraph: evaluateAttributeGraph,
    }),
    updateComputedAttributeProjection,
    rebuildComputedAttributes,
    getComputedAttributes: new GetComputedAttributes({
      attributes: computedAttributes,
      resolveIdentity,
    }),
    computedAttributeProjectionWorker: new ComputedAttributeProjectionWorker({
      attributes: computedAttributes,
      rebuild: rebuildComputedAttributes,
    }),
    createSegment: new CreateSegment({
      definitions: segmentDefinitions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    updateSegment: new UpdateSegment({
      definitions: segmentDefinitions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    deleteSegment: new DeleteSegment({
      definitions: segmentDefinitions,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
    }),
    evaluateSegment,
    evaluateAllSegments,
    updateSegmentMembershipProjection,
    recalculateMemberships: new RecalculateMemberships({
      definitions: segmentDefinitions,
      evaluateAll: evaluateAllSegments,
    }),
    rebuildSegmentMembership,
    getSegmentMembers: new GetSegmentMembers({ segments }),
    getCustomerSegments: new GetCustomerSegments({ segments, resolveIdentity }),
    segmentProjectionWorker: new SegmentProjectionWorker({
      segments,
      rebuild: rebuildSegmentMembership,
    }),
    segmentMembershipWorker: new SegmentMembershipWorker({
      segments,
      definitions: segmentDefinitions,
      evaluateAll: evaluateAllSegments,
    }),
    drainOutbox,
  };
}

/**
 * Composition root — Prisma slice when `prisma` is present (production; Phase 9 hardening closes
 * the gap the Phase 6.1 audit §13.1 flagged), else in-memory (dev/test). Mirrors
 * `wireIdentity`/`wireFinance`'s own branch exactly. Wires domain → application → stores → outbox →
 * relay/CDC, for the Identity Engine (Phase 6.1), the Profile Engine (Phase 6.2), the Session
 * Stitching Engine (Phase 6.3), the Computed Attributes Engine (Phase 6.4), and the Segmentation
 * Engine (Phase 6.5).
 */
export function wireCustomer360(deps: Customer360WiringDeps): WiredCustomer360 {
  // Production path: Prisma stores across all five engines + tx-scoped outbox (ADR-0003/0008).
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new IdentityEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "customer360",
    });
    const context = rootEventContext(deps.idGenerator);
    // Deps shared by every append-only (event-emitting) store.
    const ledgerDeps = {
      prisma: deps.prisma,
      outbox,
      context,
      idGenerator: deps.idGenerator,
    };
    // Deps shared by every upsertable-cache store (no outbox — caches never emit their own events).
    const cacheDeps = { prisma: deps.prisma, idGenerator: deps.idGenerator };

    const stores: Customer360Stores = {
      graph: new PrismaIdentityGraphStore(ledgerDeps),
      decisions: new PrismaIdentityDecisionStore(ledgerDeps),
      profiles: new PrismaProfileStore(cacheDeps),
      profileHistory: new PrismaProfileHistoryStore(ledgerDeps),
      sessions: new PrismaSessionStore(cacheDeps),
      sessionHistory: new PrismaSessionHistoryStore(ledgerDeps),
      journey: new PrismaJourneyStore(ledgerDeps),
      computedAttributes: new PrismaAttributeStore(cacheDeps),
      attributeHistory: new PrismaAttributeHistoryStore(ledgerDeps),
      attributeDefinitions: new PrismaAttributeDefinitionRegistry({ prisma: deps.prisma }),
      segments: new PrismaSegmentStore(cacheDeps),
      segmentHistory: new PrismaSegmentHistoryStore(ledgerDeps),
      segmentDefinitions: new PrismaSegmentDefinitionRegistry(ledgerDeps),
      unitOfWork: new PrismaUnitOfWork(deps.prisma),
    };

    return buildWiredCustomer360(deps, stores, async () => 0);
  }

  // In-memory / dev slice: one outbox + relay, all events delivered through the local bus.
  const context = rootEventContext(deps.idGenerator);
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new IdentityEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "customer360",
  });

  const stores: Customer360Stores = {
    graph: new InMemoryIdentityGraphStore({ outbox, context }),
    decisions: new InMemoryIdentityDecisionStore({ outbox, context }),
    profiles: new InMemoryProfileStore(),
    profileHistory: new InMemoryProfileHistoryStore({ outbox, context }),
    sessions: new InMemorySessionStore(),
    sessionHistory: new InMemorySessionHistoryStore({ outbox, context }),
    journey: new InMemoryJourneyStore({ outbox, context }),
    computedAttributes: new InMemoryAttributeStore(),
    attributeHistory: new InMemoryAttributeHistoryStore({ outbox, context }),
    attributeDefinitions: new InMemoryAttributeDefinitionRegistry(
      deps.computedAttributeDefinitions,
    ),
    segments: new InMemorySegmentStore(),
    segmentHistory: new InMemorySegmentHistoryStore({ outbox, context }),
    segmentDefinitions: new InMemorySegmentDefinitionRegistry(
      { outbox, context },
      deps.segmentDefinitions,
    ),
    unitOfWork: new InMemoryUnitOfWork(),
  };

  const bus = new InMemoryEventBus();
  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return buildWiredCustomer360(deps, stores, () => relay.drainOnce());
}
