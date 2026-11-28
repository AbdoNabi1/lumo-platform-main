/**
 * `@platform/tracking` — the Universal Event & Tracking Platform (ADR-0032, D-077).
 *
 * Platform Foundation, **not** a bounded context: this package imports no bounded context and has
 * no dependency on Billing, Operations or any Commerce domain. Every external collaborator
 * (consent, identity, storage, transport) is an outbound port bound at the composition root.
 *
 * It is also the **only** component permitted to emit tracking events to an advertising or
 * analytics vendor — enforced by dependency-cruiser and `scripts/governance/run.mjs`, not by
 * convention.
 *
 * Implements the CONTRACT docs 09 (tracking + server-side), 16 (tracking specification) and
 * 17 (attribution specification).
 *
 * **K7 (partial).** This barrel intentionally exports a narrower surface than the full package
 * source tree contains. `definitions/{capability,dictionary,event-definition,parameter,
 * resolution,registry-graph}.ts`, all of `execution/*`, `inspector/timeline.ts`,
 * `runtime/{replay-runtime,telemetry}.ts` and `browser/*` exist on disk but are deliberately not
 * wired into this barrel yet — see `K7_FINAL_RECONCILIATION_REPORT.md` at the repo root for why
 * (no primary-source evidence names their ownership, and/or they are only reachable by importing
 * the still-unevidenced `definitions` cluster). Re-add their export blocks in a follow-up
 * milestone once that evidence gap is closed, rather than assuming this list is exhaustive.
 */

// --- Collector: the public entrance for browser-emitted events (P0-1) -----
//
// Parses, validates and resolves client context, then hands back a publishable envelope. It runs
// NO pipeline stage — the collector app publishes to `tracking.event.captured.v1` and stops there.
export type {
  HeaderLookup,
  CookieLookup,
  ClientIpPolicy,
  ResolvedClientIp,
  ResolvedUserAgent,
  ResolvedCookies,
} from "./collector/client-context";
export {
  COLLECTOR_COOKIES,
  resolveClientIp,
  resolveUserAgent,
  resolveCookies,
  parseCookieHeader,
  deriveFbc,
} from "./collector/client-context";
export type {
  WriteKeyResolverPort,
  CollectorRequest,
  CollectorDeps,
  CollectorRefusal,
  CollectorOutcome,
  CookieDirective,
  TrackingCapturedEventPayload,
} from "./collector/collector";
export {
  collect,
  TRACKING_CAPTURED_TOPIC,
  TRACKING_CAPTURED_VERSION,
  PERMANENT_COLLECTOR_REFUSALS,
} from "./collector/collector";

// --- Envelope -------------------------------------------------------------
export type {
  EventSource,
  EventOrigin,
  ActionSource,
  EventType,
  EventCategory,
  TrackingEnvironment,
  PageContext,
  UserContext,
  SessionContext,
  DeviceContext,
  MarketingContext,
  TrackingContext,
  TenancyContext,
  TraceContext,
  TrackingEnvelope,
  EnrichedEnvelope,
} from "./envelope/envelope";

// --- Consent (fail-closed forwarding gate) --------------------------------
export type {
  ConsentCategory,
  ConsentGrants,
  ConsentPurpose,
  ConsentDenial,
  ConsentDecision,
  ConsentSnapshot,
  ConsentPolicy,
} from "./envelope/consent";
export {
  CONSENT_CATEGORIES,
  CONSENT_POLICIES,
  CONSENT_REQUIREMENTS,
  DEFAULT_CONSENT_POLICY,
  DENY_ALL_CONSENT,
  applyConsentPolicy,
  evaluateConsent,
} from "./envelope/consent";

/**
 * @deprecated Sprint-0.1 name retained for public-API stability (FF-API-01).
 * Use {@link ConsentSnapshot}, which adds granular Consent Mode v2 grants and provenance.
 */
export type { ConsentSnapshot as ConsentState } from "./envelope/consent";

// --- Identity -------------------------------------------------------------
export type {
  HashStatus,
  IdentityConfidence,
  IdentityContext,
  IdentityEdge,
  IdentifierType,
} from "./envelope/identity-context";
export {
  ADVANCED_MATCHING_FIELDS,
  isKnownIdentity,
  matchQualitySignals,
} from "./envelope/identity-context";

// --- Technical ------------------------------------------------------------
export type { TechnicalContext, DeviceType } from "./envelope/technical-context";
export { DEVICE_TYPES, isDeviceType } from "./envelope/technical-context";

// --- Attribution ----------------------------------------------------------
export type {
  ChannelGroup,
  AttributionModel,
  AttributionContext,
  Touchpoint,
  AttributionCredit,
} from "./envelope/attribution-context";
export { CHANNEL_GROUPS, ATTRIBUTION_MODELS } from "./envelope/attribution-context";

// --- Click identifiers ----------------------------------------------------
export type {
  ClickIdDefinition,
  ClickIdPlatform,
  ClickIdName,
  CapturedClickId,
  MetaBrowserIds,
  QueryLookup,
} from "./envelope/click-ids";
export {
  CLICK_ID_DEFINITIONS,
  CLICK_ID_NAMES,
  isClickIdName,
  isClickIdValidAt,
  extractClickIds,
} from "./envelope/click-ids";

// --- Payload --------------------------------------------------------------
export type { LineItem, EventPayload } from "./envelope/payload";
export { isCurrencyCode, deriveNumItems } from "./envelope/payload";

// --- Pipeline: normalization (always before hashing) ----------------------
export {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeCity,
  normalizeCountry,
  normalizeState,
  normalizePostalCode,
  normalizeGender,
  normalizeBirthDate,
  normalizeIdentity,
} from "./pipeline/normalization";

// --- Pipeline: validation (failing events are never delivered) ------------
export type { ValidationRule, ValidationViolation, ValidationResult } from "./pipeline/validation";
export {
  MAX_BUSINESS_EVENT_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  MAX_FUTURE_SKEW_MS,
  validateEnvelope,
  validateDeduplication,
  combineValidation,
} from "./pipeline/validation";

// --- Pipeline: channel resolution -----------------------------------------
export type { ChannelSignals, ChannelResolution } from "./pipeline/channel-resolver";
export {
  resolveChannel,
  SEARCH_ENGINE_HOSTS,
  SOCIAL_HOSTS,
  MARKETPLACE_HOSTS,
} from "./pipeline/channel-resolver";

// --- Pipeline: enrichment (click ids are merged, never replaced) -----------
export type { PersistedAttribution, EnrichmentInput } from "./pipeline/enrichment";
export { mergeClickIds, enrichAttribution, enrichContext } from "./pipeline/enrichment";

// --- Pipeline: identity stitching (append-only, immutable) ----------------
export type { IdentityNode, IdentityGraph, ResolvedIdentity } from "./pipeline/identity-graph";
export {
  EMPTY_IDENTITY_GRAPH,
  DETERMINISTIC_FLOOR,
  PROBABILISTIC_CEILING,
  nodeKey,
  addNode,
  addEdge,
  classifyEdge,
  resolveIdentity,
  scoreConfidence,
  stitchFromIdentifiers,
} from "./pipeline/identity-graph";

// --- Pipeline: attribution ------------------------------------------------
export type { AttributionSnapshot } from "./pipeline/attribution";
export {
  TIME_DECAY_HALF_LIFE_DAYS,
  POSITION_FIRST_WEIGHT,
  POSITION_LAST_WEIGHT,
  assignCredit,
  computeAttribution,
  creditsAreNormalized,
} from "./pipeline/attribution";

// --- Pipeline: PII hashing (after normalize/stitch/consent; never twice) --
export type { PipelineStage } from "./pipeline/hashing";
export {
  HASHED_FIELDS,
  DoubleHashError,
  hashIdentity,
  isForwardable,
  PIPELINE_STAGES,
  stageIndex,
  stagePrecedes,
} from "./pipeline/hashing";

// --- Lead-site plan B — match keys, event ids, lead decision ----------------------------
export type { MatchPlatform, PlatformMatchKeys } from "./pipeline/platform-identity";
export {
  splitFullName,
  emailForPlatform,
  phoneForPlatform,
  platformMatchKeys,
} from "./pipeline/platform-identity";
export type { BusinessEventKind } from "./ids/event-id";
export {
  EVENT_ID_PREFIX,
  isBusinessRef,
  newBrowserEventId,
  businessEventId,
  isMorbehEventId,
  checkProvidedDedupId,
} from "./ids/event-id";
export type { LeadEmissionLedgerPort } from "./leads/lead-emission";
export {
  LEAD_CLAIM_TTL_SECONDS,
  leadEmissionKey,
  decideLeadEmission,
  extendLeadClaim,
  InMemoryLeadEmissionLedger,
} from "./leads/lead-emission";

// --- Delivery: destination contracts + Registry ports ---------------------
export type {
  DestinationKey,
  DestinationTransport,
  DeliveryChannel,
  DestinationDefinition,
  EndpointDescriptor,
  RetryDescriptor,
  RateLimitDescriptor,
  CircuitBreakerDescriptor,
  DeliveryRequest,
  DeliveryResponse,
  DestinationAdapter,
  DestinationRegistryPort,
  AdapterRegistryPort,
  DestinationStatus,
  RoutingContext,
  EndpointAuth,
} from "./delivery/destination";
export {
  DESTINATION_STATUS_TO_REGISTRY,
  REGISTRY_TO_DESTINATION_STATUS,
  toRoutingContext,
} from "./delivery/destination";

// --- Delivery: mapping engine (configuration, no payload builders) --------
export type {
  TransformName,
  TransformFn,
  TransformRegistryPort,
  FieldMapping,
  MappingProfile,
  MappingFailure,
  MappingOutcome,
  MappingRegistryPort,
} from "./delivery/mapping";
export type { MappingFallback } from "./delivery/mapping";
export { BUILT_IN_TRANSFORMS, applyMapping, mappingFallbacks } from "./delivery/mapping";

// --- Delivery: resilience (composes messaging RetryPolicy) ----------------
export type {
  CircuitStatus,
  CircuitState,
  RateLimitState,
  RateLimitDecision,
} from "./delivery/resilience";
export {
  INITIAL_CIRCUIT,
  canAttempt,
  refreshCircuit,
  recordSuccess,
  recordFailure,
  initialRateLimit,
  refill,
  consumeToken,
} from "./delivery/resilience";

// --- Delivery: registry-driven router (no switch, no hardcoded providers) --
export type {
  RuleSetRegistryPort,
  RoutingExclusionReason,
  RoutedDestination,
  ExcludedDestination,
  RoutingDecision,
  RouteInput,
} from "./delivery/router";
export { route } from "./delivery/router";

// --- Delivery: enforcement gate + retry/DLQ orchestration -----------------
export type {
  EnforcementFailure,
  DeliveryOutcome,
  DeliveryMetrics,
  DeliveryMetricsPort,
  DestinationHealth,
  DeliveryDeps,
  DeliverInput,
  DeliveryResult,
} from "./delivery/delivery-pipeline";
export type { RenderOutcome, RenderExtras } from "./delivery/delivery-pipeline";
export {
  ZERO_METRICS,
  DELIVERY_GUARANTEES,
  enforceDeliveryPreconditions,
  renderPayload,
  deliver,
  deriveHealth,
} from "./delivery/delivery-pipeline";

// --- Delivery: transports + platform seed configuration -------------------
export type {
  HttpTransportPort,
  CredentialResolverPort,
  HttpJsonAdapterDeps,
} from "./delivery/adapters";
export {
  HttpJsonAdapter,
  NoopAdapter,
  isRetryableStatus,
  redactSecrets,
} from "./delivery/adapters";

// --- Delivery: per-vendor typed request builders (lead-site plan D1) -------
export type { VendorBuilderKey, CanonicalEvent } from "./delivery/vendor-event-names";
export {
  VENDOR_BUILDER_KEYS,
  isVendorBuilderKey,
  MATCH_PLATFORM_OF,
  CANONICAL_EVENTS,
  VENDOR_EVENT_NAMES,
  vendorEventName,
  SITE_TYPE_EVENTS,
} from "./delivery/vendor-event-names";
export type { VendorEventInput } from "./delivery/vendor-event-input";
export { vendorEventInputFrom, gaClientIdFromCookie } from "./delivery/vendor-event-input";
export type { VendorTarget, BuildResult } from "./delivery/vendor-builders";
export { buildVendorPayload, GA4_MAX_EVENT_AGE_MS } from "./delivery/vendor-builders";

// --- Delivery: business payload vs transport envelope ---------------------
export type {
  BusinessPayloadResult,
  TransportEnvelope,
  TransportEnvelopeFactory,
} from "./delivery/transport-envelope";
export {
  TRANSPORT_METADATA_KEYS,
  BUSINESS_TIME_KEYS,
  toBusinessPayload,
  findTransportMetadata,
  isBusinessPayloadClean,
} from "./delivery/transport-envelope";
export {
  SEED_DESTINATIONS,
  SEED_MAPPING_PROFILES,
  SEED_PROFILE_KEYS,
  STANDARD_RETRY,
} from "./delivery/platform-profiles";

// --- Inspector: the immutable event record (canonical source of truth) ----
export type {
  ProcessingVersions,
  StageHistoryEntry,
  RetryHistoryEntry,
  DestinationHistoryEntry,
  DeliveryState,
  EventState,
  EventRecord,
  EventRecordStorePort,
  EventRecordWriterPort,
  EventRecordFilter,
} from "./inspector/event-record";
export {
  TRACKING_SCHEMA_VERSION,
  PIPELINE_VERSION,
  currentVersions,
  deriveEventState,
  appendStage,
  appendAttempt,
  totalAttempts,
} from "./inspector/event-record";

// --- Inspector: payload integrity (verifiable replay determinism) ---------
export type { IntegrityResult } from "./inspector/payload-integrity";
export {
  PAYLOAD_DIGEST_ALGORITHM,
  NonCanonicalizableValueError,
  canonicalize,
  computePayloadDigest,
  verifyPayloadDigest,
} from "./inspector/payload-integrity";

// --- Inspector: delivery → record wiring (M6) -----------------------------
export type {
  RecordDeliveryInput,
  BuildRecordInput,
  PendingEntryInput,
} from "./inspector/record-delivery";
export {
  toDeliveryState,
  buildPendingEntry,
  buildRetryHistory,
  buildDestinationEntry,
  buildEventRecord,
} from "./inspector/record-delivery";

// NOTE: "./inspector/timeline" (forensic timeline + live stream) is not exported here — K7
// partial, no primary-source evidence found for its ownership. See K7_FINAL_RECONCILIATION_REPORT.md.

// --- Replay: deterministic, starts at destination routing -----------------
export type {
  ReplayScope,
  ReplayStatus,
  ReplayRefusal,
  ReplayTarget,
  ReplayPlan,
  ReplayRequest,
  ReplayProgress,
  ReplayCancellationPort,
  ReplayDispatchPort,
  ReplayStage,
  PlanDeps,
  ExecuteDeps,
} from "./replay/replay";
export {
  eligibleEntries,
  planReplay,
  planReplayVerified,
  executeReplay,
  REPLAY_STAGES,
  REPLAY_FORBIDDEN_STAGES,
  DESTINATION_LIFECYCLE_REFUSALS,
} from "./replay/replay";

// --- Replay: immutable audit ----------------------------------------------
export type { ReplayAuditAction, ReplayAuditEntry, ReplayAuditPort } from "./replay/replay-audit";
export { previewEntry, startedEntry, finishedEntry } from "./replay/replay-audit";

// --- Queue: scheduling / priority / delay / replay / DLQ recovery ONLY ----
export type {
  QueuePriority,
  QueueReason,
  QueueItem,
  DeliveryQueuePort,
  DeadLetterRecoveryPort,
} from "./queue/queue";
export {
  QUEUE_PRIORITIES,
  compareQueueItems,
  dueItems,
  scheduleAfter,
  defaultPriority,
} from "./queue/queue";

// --- Runtime: recording delivery (no event leaves without an EventRecord) --
//
// `receiveAndDeliver` is deliberately **NOT exported** (P0-2). It is the last gate before a vendor
// call, and every guarantee that makes the platform trustworthy — the record appended before the
// first transmission, consent re-checked per destination, PII hashed, dedup enforced — is enforced
// by `ingestTrackingEvent` on the way in. A caller reaching `receiveAndDeliver` directly skips all
// of it while appearing to use the engine correctly.
//
// Until now the guarantee was convention: the function was exported, one caller happened to exist,
// and review was the only thing preventing a second. It is now structural, in three independent
// layers, so it cannot regress by omission:
//
//   1. Not in this barrel — and `package.json#exports` maps only `"."`, so no deep import path into
//      `src/runtime/delivery-runtime` resolves for any consumer.
//   2. `FF-ARCH-09` (scripts/governance/run.mjs) fails the build if the identifier appears anywhere
//      outside `packages/tracking/src/runtime/`. That scan covers `apps/` too, which
//      dependency-cruiser currently does not (see FF-ARCH-RUNTIME).
//   3. `receive-and-deliver-internal.test.ts` asserts the barrel does not export it.
//
// The types below stay exported: a composition root must be able to *build* `RecordingRuntimeDeps`
// without being able to *invoke* the function that consumes them.
export type {
  DeliveryPhase,
  VersionResolverPort,
  DestinationRuntimeState,
  DestinationStatePort,
  RecordingRuntimeDeps,
  ReceiveEventInput,
  ReceiveEventOutput,
} from "./runtime/delivery-runtime";
export { DELIVERY_PHASES, InMemoryDestinationState } from "./runtime/delivery-runtime";

// --- Runtime: ingest (the single entry into the recording pipeline) -------
export type {
  IngestRefusal,
  IngestOutcome,
  IngestRuntimeDeps,
  IngestInput,
  UnroutedReason,
} from "./runtime/ingest-runtime";
export {
  PERMANENT_INGEST_REFUSALS,
  isPermanentRefusal,
  ingestTrackingEvent,
} from "./runtime/ingest-runtime";

// --- Runtime: durable per-destination retry within the vendor window (P1-D2) ---
export type {
  DeliveryRetryKey,
  DeliveryRetryEntry,
  DeliveryRetryQueuePort,
  RetryDisposition,
} from "./runtime/delivery-retry";
export { dispositionOf, storableError } from "./runtime/delivery-retry";
export type {
  RetryTenantRuntime,
  RetrySweepDeps,
  RetrySweepReport,
} from "./runtime/delivery-retry-sweeper";
export { sweepDeliveryRetries } from "./runtime/delivery-retry-sweeper";
export {
  DURABLE_RETRY_BACKOFF_MS,
  VENDOR_WINDOW_MS,
  planNextRetry,
  vendorWindowMs,
  windowExpiresAtMs,
} from "./delivery/retry-schedule";
export type { NextRetry } from "./delivery/retry-schedule";

// NOTE: "./runtime/replay-runtime" and "./runtime/telemetry" are not exported here — K7 partial,
// no primary-source evidence found for their ownership. See K7_FINAL_RECONCILIATION_REPORT.md.

// --- Deduplication --------------------------------------------------------
export type { HashPort, NaturalKeyStrategy } from "./ids/dedup-id";
export {
  DEDUP_WINDOW_DAYS,
  minuteBucket,
  dedupKeyMaterial,
  deriveDedupId,
  isWithinDedupWindow,
} from "./ids/dedup-id";

// --- Transformation Metadata (declarative only; execution stays in delivery/mapping.ts) ---
//
// K7 partial: only this one file from the full `definitions/*` cluster is exported here. The rest
// of `definitions/*` (capability, dictionary, event-definition, parameter, resolution,
// registry-graph) is not re-exported as a wildcard — see K7_FINAL_RECONCILIATION_REPORT.md.
export type {
  TransformCategory,
  TransformCost,
  TransformMetadata,
  TransformMetadataRegistryPort,
} from "./definitions/transformation-metadata";
export {
  BUILT_IN_TRANSFORM_METADATA,
  metadataFor,
  isSafeToRepeat,
} from "./definitions/transformation-metadata";

// --- P5.5 areas (see each area barrel for the full export list) -----------
//
// "./browser" (E2) and "./execution" (entangled with the unevidenced definitions cluster) are not
// exported here. See K7_FINAL_RECONCILIATION_REPORT.md.
export * from "./intelligence";

// --- Tracking P1-D4/D10: the visitor profile store, merge/enrich and retention ---
export {
  EVENT_NETWORK_RETENTION_DAYS,
  MAX_CLICK_ID_LENGTH,
  PROFILE_HASH_KEYS,
  PROFILE_TTL_DAYS,
  PROFILE_TTL_MS,
  expiresAtFor,
  hasMatchKeys,
  isAnonymousProfile,
} from "./profile/tracking-profile";
export type {
  ProfileBrowserIds,
  ProfileClickId,
  ProfileClickIds,
  ProfileGeo,
  ProfileHashes,
  ProfileLandingTouch,
  ProfileLookupKeys,
  ProfileObservation,
  TrackingProfile,
} from "./profile/tracking-profile";
export {
  applyObservation,
  createProfile,
  customersConflict,
  mergeProfileClickIds,
  mergeProfiles,
  pruneClickIds,
  survivorOf,
} from "./profile/profile-merge";
export { InMemoryTrackingProfileStore } from "./profile/profile-store";
export type {
  ExpiredProfileScan,
  ProfileChange,
  TrackingProfileStore,
} from "./profile/profile-store";
export { deriveProfileHashes, profileMatchKeys, withProfileKeys } from "./profile/profile-identity";
export type { ProfileMatchKeys } from "./profile/profile-identity";
export {
  customerIdOf,
  enrichEnvelopeWithProfile,
  isObservable,
  observationFromEnvelope,
  visitorIdOf,
} from "./profile/profile-envelope";
export { TrackingProfileService, resolveProfile } from "./profile/profile-service";
export type {
  ProfileEnricherPort,
  ProfileEnrichment,
  ProfileResolution,
  ProfileServiceDeps,
} from "./profile/profile-service";
export {
  eraseCustomerProfiles,
  redactDestinationEntries,
  redactEnvelopeNetwork,
  redactPayloadNetwork,
  runTrackingRetention,
} from "./profile/retention";
export type {
  EventNetworkRedactionPort,
  TrackingRetentionDeps,
  TrackingRetentionReport,
} from "./profile/retention";
export { fbcCreatedAtMs, isFbcValidAt } from "./envelope/click-ids";
export {
  COOKIE_KEEPER_MAX_VALUE,
  COOKIE_KEEPER_NAMES,
  restorableCookies,
} from "./profile/cookie-keeper";
export type { CookieKeeperInput, CookieKeeperName } from "./profile/cookie-keeper";

// Tracking P1-D8 / D9: collect-time enrichment and the per-store IP block list.
export { parseUserAgent } from "./enrichment/user-agent";
export type { BotMarker, BotMarkerKind, UserAgentInfo } from "./enrichment/user-agent";
export { BOT_REASON_POINTS, BOT_SKIP_THRESHOLD, botBand, scoreBot } from "./enrichment/bot-score";
export type { BotBand, BotReason, BotScore, BotSignals } from "./enrichment/bot-score";
export { AI_SOURCES, aiSourceKeyOf, resolveAiSource } from "./enrichment/ai-referrer";
export type { AiSource, AiSourceSignals } from "./enrichment/ai-referrer";
export { computeFingerprintId, fingerprintKeyFor } from "./enrichment/fingerprint";
export type { FingerprintInput, HmacSha256Hex } from "./enrichment/fingerprint";
export {
  MmdbFormatError,
  MmdbGeoLookup,
  UNKNOWN_GEO,
  createMmdbGeoLookup,
} from "./enrichment/geo-mmdb";
export type { GeoLookupPort, GeoResult } from "./enrichment/geo-mmdb";
export {
  compileIpMatcher,
  formatCidr,
  isPublicIp,
  normalizeCidr,
  parseCidr,
  parseIp,
} from "./enrichment/ip-cidr";
export type { IpMatcher } from "./enrichment/ip-cidr";
export { BUSINESS_CONVERSION_EVENTS, isBusinessConversion } from "./enrichment/business-conversion";
export { createCollectEnricher } from "./enrichment/collect-enrichment";
export type {
  BurstPort,
  BurstVerdict,
  CollectEnricher,
  CollectEnricherDeps,
  CollectSignals,
} from "./enrichment/collect-enrichment";
export {
  BlockedIpService,
  InMemoryBlockedIpStore,
  MAX_BLOCKED_IPS_PER_STORE,
  MAX_NOTE_LENGTH,
} from "./blocking/blocked-ips";
export type {
  AddBlockedIpResult,
  BlockedIpEntry,
  BlockedIpServiceDeps,
  BlockedIpStore,
} from "./blocking/blocked-ips";

// --- Per-store tracking settings: consent policy, cookie notice (P2-D1) ---
export {
  InMemoryTrackingSettingsStore,
  SETTINGS_CACHE_TTL_MS,
  TrackingSettingsService,
  defaultTrackingSettings,
} from "./settings/store-settings";
export type {
  ConsentPolicyPort,
  TrackingSettingsInput,
  TrackingSettingsSave,
  TrackingSettingsServiceDeps,
  TrackingSettingsStore,
  TrackingSettingsUpdate,
  TrackingStoreSettings,
} from "./settings/store-settings";

// --- Business events: orders and leads to server-side conversions (P2 Task 2) ---
// Read models are plain data: the runtime adapters (orders reader, lead emitter) return them, the mappers consume them.
export type {
  BusinessAttributionSnapshot,
  BusinessEventContext,
  LeadTrackingReadModel,
  OrderTrackingCustomer,
  OrderTrackingLine,
  OrderTrackingReadModel,
  OrderTrackingShipping,
  OrderTrackingTotals,
  SnapshotClickId,
  TransitionEventContext,
} from "./business/order-read-model";
export { cancelledEnvelope, deliveredEnvelope, purchaseEnvelope } from "./business/order-events";
export { leadEnvelope } from "./business/lead-event";
export { contentIdOf } from "./business/content-id";
export { businessValueMinor } from "./business/value";
export type { OrderValueTotals } from "./business/value";
export { businessMessageId } from "./business/event-uuid";
export { syntheticGaClientId } from "./business/ga4-client-id";
export {
  callingCodeForCurrency,
  CURRENCY_CALLING_CODES,
  DEFAULT_CALLING_CODE,
} from "./business/calling-code";
