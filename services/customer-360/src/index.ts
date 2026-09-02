export { wireCustomer360 } from "./composition";
export type { Customer360WiringDeps, WiredCustomer360 } from "./composition";
export { Customer360Controller } from "./interfaces/customer-360.controller";
export type {
  Customer360ControllerDeps,
  GetProfileRequest,
  GetIdentifierTimelineRequest,
  GetVisitorJourneyRequest,
} from "./interfaces/customer-360.controller";
export type { ControllerResponse } from "./interfaces/presenter";

export type { IdentityCluster } from "./ports/identity-cluster";
export { toIdentityCluster } from "./ports/identity-cluster";
export type { IdentifierRef, IdentityDecision } from "./ports/identity-decision";
export type { IdentityDecisionStore } from "./ports/identity-decision-store";
export type { IdentityGraphStore } from "./ports/identity-graph-store";
export { excludeRetractedEdges } from "./ports/identity-resolution";
export type { IdentityTimelineEntry } from "./ports/identity-timeline";
export type { ProfileStore } from "./ports/profile-store";
export type { ProfileHistoryStore } from "./ports/profile-history-store";
export type { SessionStore } from "./ports/session-store";
export type { SessionHistoryStore } from "./ports/session-history-store";
export type { JourneyStore } from "./ports/journey-store";
export type { SessionTimelineEntry } from "./ports/session-timeline";
export type { AttributeStore } from "./ports/attribute-store";
export type { AttributeHistoryStore } from "./ports/attribute-history-store";
export type { AttributeDefinitionRegistry } from "./ports/attribute-definition-registry";
export type { ComputedAttributeDefinition } from "./ports/computed-attribute-definition";
export type {
  AttributeEvaluationResult,
  AttributeInputProvenance,
} from "./ports/attribute-evaluation";
export type { SegmentDefinition } from "./ports/segment-definition";
export { INITIAL_SEGMENT_DEFINITION_VERSION } from "./ports/segment-definition";
export type { SegmentDefinitionRegistry } from "./ports/segment-definition-registry";
export type { SegmentStore } from "./ports/segment-store";
export type { SegmentHistoryStore } from "./ports/segment-history-store";
export type { SegmentEvaluationResult, SegmentExplanation } from "./ports/segment-evaluation";
export { explainSegmentEvaluation } from "./ports/segment-evaluation";

export { IdentityLinkObserved } from "./events/identity-link-observed.event";
export type { IdentityLinkObservedData } from "./events/identity-link-observed.event";
export { IdentityMerged } from "./events/identity-merged.event";
export type { IdentityMergedData } from "./events/identity-merged.event";
export { IdentitySplit } from "./events/identity-split.event";
export type { IdentitySplitData } from "./events/identity-split.event";
export { ProfileCreated } from "./events/profile-created.event";
export type { ProfileCreatedData } from "./events/profile-created.event";
export { ProfileUpdated } from "./events/profile-updated.event";
export type { ProfileUpdatedData } from "./events/profile-updated.event";
export { ProfileRebuilt } from "./events/profile-rebuilt.event";
export type { ProfileRebuiltData } from "./events/profile-rebuilt.event";
export { SessionStarted } from "./events/session-started.event";
export type { SessionStartedData } from "./events/session-started.event";
export { SessionUpdated } from "./events/session-updated.event";
export type { SessionUpdatedData } from "./events/session-updated.event";
export { SessionClosed } from "./events/session-closed.event";
export type { SessionClosedData } from "./events/session-closed.event";
export { SessionMerged } from "./events/session-merged.event";
export type { SessionMergedData } from "./events/session-merged.event";
export { SessionSplit } from "./events/session-split.event";
export type { SessionSplitData } from "./events/session-split.event";
export { AttributeCreated } from "./events/attribute-created.event";
export type { AttributeCreatedData } from "./events/attribute-created.event";
export { AttributeUpdated } from "./events/attribute-updated.event";
export type { AttributeUpdatedData } from "./events/attribute-updated.event";
export { AttributeRebuilt } from "./events/attribute-rebuilt.event";
export type { AttributeRebuiltData } from "./events/attribute-rebuilt.event";
export { SegmentCreated } from "./events/segment-created.event";
export type { SegmentCreatedData } from "./events/segment-created.event";
export { SegmentUpdated } from "./events/segment-updated.event";
export type { SegmentUpdatedData } from "./events/segment-updated.event";
export { SegmentDeleted } from "./events/segment-deleted.event";
export type { SegmentDeletedData } from "./events/segment-deleted.event";
export { CustomerEnteredSegment } from "./events/customer-entered-segment.event";
export type { CustomerEnteredSegmentData } from "./events/customer-entered-segment.event";
export { CustomerExitedSegment } from "./events/customer-exited-segment.event";
export type { CustomerExitedSegmentData } from "./events/customer-exited-segment.event";
export { MembershipRebuilt } from "./events/membership-rebuilt.event";
export type { MembershipRebuiltData } from "./events/membership-rebuilt.event";

// Phase 6.2 — Profile Engine domain (Identity Engine intentionally has no domain/ layer of its own;
// see CUSTOMER360_ARCHITECTURE_AUDIT.md and the Phase 6.2 report for why Profile does).
export type {
  CustomerProfile,
  FieldUpdateInput,
  FieldUpdateResult,
} from "./domain/customer-profile";
export { applyFieldUpdate, createEmptyProfile } from "./domain/customer-profile";
export type { ProfileField, ProfileFieldConfidence } from "./domain/profile-field";
export { createProfileField } from "./domain/profile-field";
export type { ProfileSnapshot, ProfileSnapshotReason } from "./domain/profile-snapshot";
export { fromSnapshot, toSnapshot } from "./domain/profile-snapshot";
export type { ProfileVersion } from "./domain/profile-version";
export { INITIAL_PROFILE_VERSION } from "./domain/profile-version";
export type { ProfileConfidenceSummary } from "./domain/profile-views";
export {
  mergeProfiles,
  profileCompleteness,
  profileConfidenceSummary,
  profileFieldSources,
  profileFreshness,
  staleFields,
} from "./domain/profile-views";

// Phase 6.3 — Session Stitching Engine domain.
export type { SessionStatus } from "./domain/session-status";
export type { SessionVersion } from "./domain/session-version";
export { INITIAL_SESSION_VERSION } from "./domain/session-version";
export type { SessionCloseReason } from "./domain/session-boundary";
export { SESSION_CLOSE_REASONS, isSessionCloseReason } from "./domain/session-boundary";
export type { SessionTransition, SessionTransitionKind } from "./domain/session-transition";
export { EXPLICIT_TRANSITION_KINDS, requiresProvenance } from "./domain/session-transition";
export { DEFAULT_SESSION_TIMEOUT_MS, withinSessionWindow } from "./domain/session-window";
export type {
  CustomerSession,
  OpenSessionInput,
  RecordActivityResult,
} from "./domain/customer-session";
export { closeSession, openSession, recordActivity } from "./domain/customer-session";
export type { SessionSnapshot, SessionSnapshotReason } from "./domain/session-snapshot";
export {
  fromSnapshot as fromSessionSnapshot,
  toSnapshot as toSessionSnapshot,
} from "./domain/session-snapshot";
export type { JourneySegment, JourneyState } from "./domain/session-views";
export { isActive, journeySegments, journeyState, sessionDuration } from "./domain/session-views";

// Phase 6.4 — Computed Attributes Engine domain.
export type { AttributeValue } from "./domain/attribute-value";
export type { AttributeVersion } from "./domain/attribute-version";
export { INITIAL_ATTRIBUTE_VERSION } from "./domain/attribute-version";
export type { ComputedAttributeValue } from "./domain/computed-attribute-value";
export { createComputedAttributeValue } from "./domain/computed-attribute-value";
export type {
  ComputedAttribute,
  AttributeUpdateInput,
  AttributeUpdateResult,
} from "./domain/computed-attribute";
export { applyAttributeUpdate, createEmptyComputedAttribute } from "./domain/computed-attribute";
export type { AttributeSnapshot, AttributeSnapshotReason } from "./domain/attribute-snapshot";
export {
  fromSnapshot as fromAttributeSnapshot,
  toSnapshot as toAttributeSnapshot,
} from "./domain/attribute-snapshot";
export type {
  AttributeDependency,
  AttributeCycleError,
  TopologicalOrderResult,
} from "./domain/attribute-dependency";
export { topologicalOrder, dependentsOf } from "./domain/attribute-dependency";
export { mergeComputedAttributes } from "./domain/computed-attribute-views";

// Phase 6.5 — Segmentation Engine domain. No `domain/segment-definition.ts` and no
// `domain/segment-dependency.ts` (SEGMENTATION_MODEL.md §3/§5) — the authored, RuleSet-bearing
// definition lives in `ports/`, and incremental recompute reuses `domain/attribute-dependency.ts`'s
// `dependentsOf`/`AttributeDependency` verbatim, already exported above.
export type { SegmentVersion } from "./domain/segment-version";
export { INITIAL_SEGMENT_VERSION } from "./domain/segment-version";
export type {
  SegmentMembership,
  SegmentMembershipStatus,
  MembershipUpdateInput,
  MembershipUpdateResult,
  MembershipTransition,
} from "./domain/segment-membership";
export { applyMembershipUpdate } from "./domain/segment-membership";
export type { CustomerSegment } from "./domain/customer-segment";
export { toCustomerSegment } from "./domain/customer-segment";
export { mergeCustomerSegments } from "./domain/segment-views";
export type { SegmentHistoryEntry, SegmentHistoryReason } from "./domain/segment-history";
export {
  fromSnapshot as fromSegmentHistorySnapshot,
  toSnapshot as toSegmentHistorySnapshot,
} from "./domain/segment-history";

export { GetIdentityTimeline } from "./application/get-identity-timeline.use-case";
export type {
  GetIdentityTimelineInput,
  GetIdentityTimelineOutput,
} from "./application/get-identity-timeline.use-case";
export { MergeIdentities } from "./application/merge-identities.use-case";
export type {
  MergeIdentitiesInput,
  MergeIdentitiesOutput,
} from "./application/merge-identities.use-case";
export { ObserveIdentityLink } from "./application/observe-identity-link.use-case";
export type {
  ObserveIdentityLinkInput,
  ObserveIdentityLinkOutput,
} from "./application/observe-identity-link.use-case";
export { ResolveIdentity } from "./application/resolve-identity.use-case";
export type {
  ResolveIdentityInput,
  ResolveIdentityOutput,
} from "./application/resolve-identity.use-case";
export { SplitIdentity } from "./application/split-identity.use-case";
export type {
  SplitIdentityInput,
  SplitIdentityOutput,
} from "./application/split-identity.use-case";
export { GetCustomerProfile } from "./application/get-customer-profile.use-case";
export type {
  GetCustomerProfileInput,
  GetCustomerProfileOutput,
} from "./application/get-customer-profile.use-case";
export { UpdateProfileProjection } from "./application/update-profile-projection.use-case";
export type {
  UpdateProfileProjectionInput,
  UpdateProfileProjectionOutput,
} from "./application/update-profile-projection.use-case";
export { RebuildProfileProjection } from "./application/rebuild-profile-projection.use-case";
export type {
  RebuildProfileProjectionInput,
  RebuildProfileProjectionOutput,
} from "./application/rebuild-profile-projection.use-case";
export { ProfileProjectionWorker } from "./application/profile-projection-worker";
export type {
  ProfileProjectionWorkerInput,
  ProfileProjectionWorkerOutput,
} from "./application/profile-projection-worker";

// Phase 6.3 — Session Stitching Engine application.
export { ObserveSession } from "./application/observe-session.use-case";
export type {
  ObserveSessionInput,
  ObserveSessionOutput,
} from "./application/observe-session.use-case";
export { CloseSession } from "./application/close-session.use-case";
export type { CloseSessionInput, CloseSessionOutput } from "./application/close-session.use-case";
export { ResumeSession } from "./application/resume-session.use-case";
export type {
  ResumeSessionInput,
  ResumeSessionOutput,
} from "./application/resume-session.use-case";
export { SplitSession } from "./application/split-session.use-case";
export type { SplitSessionInput, SplitSessionOutput } from "./application/split-session.use-case";
export { MergeSession } from "./application/merge-session.use-case";
export type { MergeSessionInput, MergeSessionOutput } from "./application/merge-session.use-case";
export { ResolveCurrentSession } from "./application/resolve-current-session.use-case";
export type {
  ResolveCurrentSessionInput,
  ResolveCurrentSessionOutput,
} from "./application/resolve-current-session.use-case";
export { RebuildSessions } from "./application/rebuild-sessions.use-case";
export type {
  RebuildSessionsInput,
  RebuildSessionsOutput,
} from "./application/rebuild-sessions.use-case";
export { SessionProjectionWorker } from "./application/session-projection-worker";
export type {
  SessionProjectionWorkerInput,
  SessionProjectionWorkerOutput,
} from "./application/session-projection-worker";
export { GetJourneyTimeline } from "./application/get-journey-timeline.use-case";
export type {
  GetJourneyTimelineInput,
  GetJourneyTimelineOutput,
} from "./application/get-journey-timeline.use-case";
export { GetJourneyState } from "./application/get-journey-state.use-case";
export type {
  GetJourneyStateInput,
  GetJourneyStateOutput,
} from "./application/get-journey-state.use-case";

// Phase 6.4 — Computed Attributes Engine application.
export { EvaluateComputedAttribute } from "./application/evaluate-computed-attribute.use-case";
export type {
  EvaluateComputedAttributeInput,
  EvaluateComputedAttributeOutput,
} from "./application/evaluate-computed-attribute.use-case";
export {
  EvaluateAttributeGraph,
  toDependencyEdges,
} from "./application/evaluate-attribute-graph.use-case";
export type {
  EvaluateAttributeGraphInput,
  EvaluateAttributeGraphOutput,
} from "./application/evaluate-attribute-graph.use-case";
export { RecalculateComputedAttributes } from "./application/recalculate-computed-attributes.use-case";
export type {
  RecalculateComputedAttributesInput,
  RecalculateComputedAttributesOutput,
} from "./application/recalculate-computed-attributes.use-case";
export { UpdateComputedAttributeProjection } from "./application/update-computed-attribute-projection.use-case";
export type {
  UpdateComputedAttributeProjectionInput,
  UpdateComputedAttributeProjectionOutput,
} from "./application/update-computed-attribute-projection.use-case";
export { RebuildComputedAttributes } from "./application/rebuild-computed-attributes.use-case";
export type {
  RebuildComputedAttributesInput,
  RebuildComputedAttributesOutput,
} from "./application/rebuild-computed-attributes.use-case";
export { GetComputedAttributes } from "./application/get-computed-attributes.use-case";
export type {
  GetComputedAttributesInput,
  GetComputedAttributesOutput,
} from "./application/get-computed-attributes.use-case";
export { ComputedAttributeProjectionWorker } from "./application/computed-attribute-projection-worker";
export type {
  ComputedAttributeProjectionWorkerInput,
  ComputedAttributeProjectionWorkerOutput,
} from "./application/computed-attribute-projection-worker";

// Phase 6.5 — Segmentation Engine application.
export { CreateSegment } from "./application/create-segment.use-case";
export type {
  CreateSegmentInput,
  CreateSegmentOutput,
} from "./application/create-segment.use-case";
export { UpdateSegment } from "./application/update-segment.use-case";
export type {
  UpdateSegmentInput,
  UpdateSegmentOutput,
} from "./application/update-segment.use-case";
export { DeleteSegment } from "./application/delete-segment.use-case";
export type {
  DeleteSegmentInput,
  DeleteSegmentOutput,
} from "./application/delete-segment.use-case";
export { EvaluateSegment } from "./application/evaluate-segment.use-case";
export type {
  EvaluateSegmentInput,
  EvaluateSegmentOutput,
} from "./application/evaluate-segment.use-case";
export {
  EvaluateAllSegments,
  collectReferencedPaths,
  toSegmentDependencyEdges,
} from "./application/evaluate-all-segments.use-case";
export type {
  EvaluateAllSegmentsInput,
  EvaluateAllSegmentsOutput,
} from "./application/evaluate-all-segments.use-case";
export { UpdateSegmentMembershipProjection } from "./application/update-segment-membership-projection.use-case";
export type {
  UpdateSegmentMembershipProjectionInput,
  UpdateSegmentMembershipProjectionOutput,
} from "./application/update-segment-membership-projection.use-case";
export { RecalculateMemberships } from "./application/recalculate-memberships.use-case";
export type {
  RecalculateMembershipsInput,
  RecalculateMembershipsOutput,
} from "./application/recalculate-memberships.use-case";
export { RebuildSegmentMembership } from "./application/rebuild-segment-membership.use-case";
export type {
  RebuildSegmentMembershipInput,
  RebuildSegmentMembershipOutput,
} from "./application/rebuild-segment-membership.use-case";
export { GetSegmentMembers } from "./application/get-segment-members.use-case";
export type {
  GetSegmentMembersInput,
  GetSegmentMembersOutput,
} from "./application/get-segment-members.use-case";
export { GetCustomerSegments } from "./application/get-customer-segments.use-case";
export type {
  GetCustomerSegmentsInput,
  GetCustomerSegmentsOutput,
} from "./application/get-customer-segments.use-case";
export { SegmentProjectionWorker } from "./application/segment-projection-worker";
export type {
  SegmentProjectionWorkerInput,
  SegmentProjectionWorkerOutput,
} from "./application/segment-projection-worker";
export { SegmentMembershipWorker } from "./application/segment-membership-worker";
export type {
  SegmentMembershipWorkerInput,
  SegmentMembershipWorkerOutput,
} from "./application/segment-membership-worker";

export {
  IdentityEventTranslator,
  CUSTOMER360_PUBLISHED_EVENTS,
} from "./infrastructure/identity-event-translator";
export { InMemoryIdentityDecisionStore } from "./infrastructure/in-memory-identity-decision-store";
export { InMemoryIdentityGraphStore } from "./infrastructure/in-memory-identity-graph-store";
export { InMemoryProfileStore } from "./infrastructure/in-memory-profile-store";
export { InMemoryProfileHistoryStore } from "./infrastructure/in-memory-profile-history-store";
export { InMemorySessionStore } from "./infrastructure/in-memory-session-store";
export { InMemorySessionHistoryStore } from "./infrastructure/in-memory-session-history-store";
export { InMemoryJourneyStore } from "./infrastructure/in-memory-journey-store";
export { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
export { PrismaIdentityDecisionStore } from "./infrastructure/prisma-identity-decision-store";
export type { PrismaIdentityDecisionStoreDeps } from "./infrastructure/prisma-identity-decision-store";
export { PrismaIdentityGraphStore } from "./infrastructure/prisma-identity-graph-store";
export type { PrismaIdentityGraphStoreDeps } from "./infrastructure/prisma-identity-graph-store";
export { PrismaProfileStore } from "./infrastructure/prisma-profile-store";
export type { PrismaProfileStoreDeps } from "./infrastructure/prisma-profile-store";
export { PrismaProfileHistoryStore } from "./infrastructure/prisma-profile-history-store";
export type { PrismaProfileHistoryStoreDeps } from "./infrastructure/prisma-profile-history-store";
export { PrismaSessionStore } from "./infrastructure/prisma-session-store";
export type { PrismaSessionStoreDeps } from "./infrastructure/prisma-session-store";
export { PrismaSessionHistoryStore } from "./infrastructure/prisma-session-history-store";
export type { PrismaSessionHistoryStoreDeps } from "./infrastructure/prisma-session-history-store";
export { PrismaJourneyStore } from "./infrastructure/prisma-journey-store";
export type { PrismaJourneyStoreDeps } from "./infrastructure/prisma-journey-store";
export { InMemoryAttributeStore } from "./infrastructure/in-memory-attribute-store";
export { InMemoryAttributeHistoryStore } from "./infrastructure/in-memory-attribute-history-store";
export { InMemoryAttributeDefinitionRegistry } from "./infrastructure/in-memory-attribute-definition-registry";
export { PrismaAttributeStore } from "./infrastructure/prisma-attribute-store";
export type { PrismaAttributeStoreDeps } from "./infrastructure/prisma-attribute-store";
export { PrismaAttributeHistoryStore } from "./infrastructure/prisma-attribute-history-store";
export type { PrismaAttributeHistoryStoreDeps } from "./infrastructure/prisma-attribute-history-store";
export {
  PrismaAttributeDefinitionRegistry,
  toDefinitionRow,
} from "./infrastructure/prisma-attribute-definition-registry";
export type { PrismaAttributeDefinitionRegistryDeps } from "./infrastructure/prisma-attribute-definition-registry";
export { attributesToJson, jsonToAttributes } from "./infrastructure/attribute-fields-json";
export { InMemorySegmentStore } from "./infrastructure/in-memory-segment-store";
export { InMemorySegmentHistoryStore } from "./infrastructure/in-memory-segment-history-store";
export { InMemorySegmentDefinitionRegistry } from "./infrastructure/in-memory-segment-definition-registry";
export { PrismaSegmentStore } from "./infrastructure/prisma-segment-store";
export type { PrismaSegmentStoreDeps } from "./infrastructure/prisma-segment-store";
export { PrismaSegmentHistoryStore } from "./infrastructure/prisma-segment-history-store";
export type { PrismaSegmentHistoryStoreDeps } from "./infrastructure/prisma-segment-history-store";
export { PrismaSegmentDefinitionRegistry } from "./infrastructure/prisma-segment-definition-registry";
export type { PrismaSegmentDefinitionRegistryDeps } from "./infrastructure/prisma-segment-definition-registry";
export {
  inputsToJson,
  jsonToInputs,
  matchedRuleIdsToJson,
  jsonToMatchedRuleIds,
} from "./infrastructure/segment-fields-json";
