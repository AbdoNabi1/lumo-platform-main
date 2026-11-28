/**
 * Tracking runtime wiring (M6.2, completed in M6.6.3) — the production composition root for
 * `@platform/tracking`.
 *
 * **Every dependency here is mandatory.** The package's own types mark several as optional because
 * they are genuinely optional *for a browser or edge caller* that never records or replays. In this
 * root they are not: a missing hasher yields records with no digest, which `verifyPayloadDigest`
 * correctly treats as `digest_absent` and refuses at replay time — meaning the failure would appear
 * months later, as an unreplayable backlog, rather than at boot when someone could fix it.
 *
 * TypeScript already makes each one a required argument. That is not sufficient on its own: this
 * root is reachable from JavaScript, from a partially-constructed `RuntimeCore`, and from a future
 * caller spreading a config object with a typo'd key — in all of which `undefined` type-checks fine.
 * So {@link wireTrackingRuntime} also *checks*, at construction, and throws naming every missing
 * dependency at once. Failing at boot with a list is the difference between a five-minute fix and a
 * silent capability loss.
 *
 * Test doubles are confined to unit tests. Nothing in this file has an in-memory fallback, because
 * a fallback that silently activates in production is worse than a boot failure.
 *
 * ## Snapshot pinning (M6.7)
 *
 * The registry arrives as a {@link TrackingRegistryHandle}, not a snapshot, because it can now be
 * hot-reloaded. The dependency graph is split accordingly:
 *
 * - **Process-lifetime, built once**: the HTTP adapter, hasher, credential resolver, record store,
 *   retry policy and — critically — `destinationState`, which holds every destination's circuit
 *   breaker and rate-limit bucket. Rebuilding that per event would reset the breaker on every event
 *   and hand each one a full token bucket, silently disabling both protections while leaving them
 *   fully configured and apparently working.
 * - **Per unit of work, bound to one pinned snapshot**: the destination, mapping, rule-set and
 *   version ports. {@link TrackingRuntime.ingest} reads `handle.current()` exactly once and threads
 *   that instance through routing, mapping, delivery and version stamping, so a reload landing
 *   mid-event is invisible to it.
 */

import type { ConnectionsForDelivery } from "@platform/ad-platforms";
import type { IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import type { SecretProvider } from "@platform/secrets";
import type { Logger } from "@platform/utils";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  type AdapterRegistryPort,
  type ConsentPolicyPort,
  type CredentialResolverPort,
  type DeliveryRetryQueuePort,
  type IngestRuntimeDeps,
  type ProfileEnricherPort,
  type RecordingRuntimeDeps,
  type RetryTenantRuntime,
  type TrackingProfileStore,
  TrackingProfileService,
} from "@platform/tracking";

import { ConnectionCredentialResolver } from "./connection-credential-resolver";
import { PrismaEventRecordStore } from "./prisma-event-record-store";
import type { TrackingRegistryHandle } from "./tracking-registry-handle";
import {
  mappingRegistryOf,
  ruleSetRegistryOf,
  type TrackingRegistrySnapshot,
} from "./tracking-registry";
import {
  FetchHttpTransport,
  NodeHashPort,
  RuntimeTransportEnvelopeFactory,
  SecretCredentialResolver,
} from "./tracking-adapters";

export interface TrackingRuntimeInput {
  readonly db: Database;
  readonly idGenerator: IdGenerator;
  readonly secrets: SecretProvider;
  /**
   * The production registry handle — destinations, mapping profiles, rule sets and the versions of
   * each (M6.6.2), behind the hot-reload indirection added in M6.7. A handle rather than a snapshot
   * so that a swap is picked up by the next event without restarting the process.
   */
  readonly registry: TrackingRegistryHandle;
  /** Registry key of the routing rule set in force. Configuration, not a compiled-in default. */
  readonly ruleSetKey: string;
  readonly clock: { now(): Date };
  /** Idempotency + dead-letter infrastructure from `@platform/messaging`, wired by the caller. */
  readonly processed: { recordIfNew(messageId: string, processedAt: string): Promise<boolean> };
  readonly deadLetters: {
    add(entry: {
      messageId: string;
      topic: string;
      value: Uint8Array;
      headers: Readonly<Record<string, string>>;
      attempts: number;
      error: string;
      failedAt: string;
    }): Promise<void>;
  };
  readonly logger: Logger;
  /**
   * Lead Site Part D1: the sealed ad platform connections, so `conn://<tenantId>/<platform>` credential
   * references (the per-shop destinations the connections create) resolve at send time. Absent ⇒ such a
   * reference resolves to nothing (a permanent "credential unresolved" failure), never to a stub.
   */
  readonly connectionCredentials?: Pick<ConnectionsForDelivery, "openSecret">;
  /**
   * Tracking P1-D2: where a delivery that failed transiently is parked for the worker's retry sweeper.
   * Absent ⇒ an exhausted delivery is dead-lettered as it was before the durable queue existed.
   */
  readonly retryQueue?: DeliveryRetryQueuePort;
  /**
   * Tracking P1-D4: where visitor profiles live. When present, every ingested event is merged with its visitor's
   * profile BEFORE routing and delivery (click ids, browser ids, IP/UA, hashes the event lacks) and then recorded
   * into it. Absent ⇒ events are forwarded exactly as they arrived.
   */
  readonly profiles?: TrackingProfileStore;
  /**
   * Tracking P2-D1: the store consent policy. When present, every ingested event is stamped with the consent its
   * store forwards under (`notice_only` by default) right after completion. Absent => consent is left as it arrived.
   */
  readonly consentPolicy?: ConsentPolicyPort;
  /**
   * Tracking P2-D7: the calling code (digits, no `+`) of the store's market, from its currency (EGP 20, SAR 966, ...).
   * Without it a national phone number (`01012345678`, how an order keeps it) cannot be made E.164, so it is dropped
   * from the vendor payloads and from the profile match. Applied to both the recording pipeline and the profile step.
   */
  readonly defaultCountryCode?: string;
}

export interface TrackingRuntime {
  /**
   * Everything the ingest entry point needs, bound to the registry snapshot current *at the moment
   * of the call*. The only supported way to reach `receiveAndDeliver`.
   *
   * **Call this once per event and reuse the result for that event.** Calling it twice within one
   * event would defeat the pinning and reintroduce exactly the mid-pipeline version skew the handle
   * exists to prevent.
   */
  ingest(): IngestRuntimeDeps;
  /**
   * What the delivery-retry sweeper (P1-D2) needs for this tenant, bound to the registry snapshot current
   * at the moment of the call — the retry analogue of {@link TrackingRuntime.ingest}, sharing its
   * process-lifetime circuit-breaker and token-bucket state, adapters and credential resolution.
   */
  retry(): RetryTenantRuntime;
  readonly store: PrismaEventRecordStore;
  readonly credentials: SecretCredentialResolver;
  readonly registry: TrackingRegistryHandle;
}

/**
 * The dependencies whose absence is unrecoverable, named so the failure message is actionable.
 *
 * Listed as data rather than checked with a chain of `if`s so the set is enumerable — a reader can
 * see at a glance what "fully wired" means, and a new mandatory dependency is one line rather than
 * a block that is easy to forget.
 */
const REQUIRED_DEPENDENCIES: readonly (keyof TrackingRuntimeInput)[] = [
  "db",
  "idGenerator",
  "secrets",
  "registry",
  "ruleSetKey",
  "clock",
  "processed",
  "deadLetters",
  "logger",
];

function assertFullyWired(input: TrackingRuntimeInput): void {
  const missing = REQUIRED_DEPENDENCIES.filter((name) => {
    const value: unknown = input[name];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `tracking runtime is not fully wired — missing: ${missing.join(", ")}. ` +
        `Every dependency is mandatory in production: a partially wired runtime records events it ` +
        `cannot later replay, and the loss is not detectable until the replay is attempted.`,
    );
  }
}

/**
 * Builds the fully wired tracking runtime.
 *
 * The single `HttpJsonAdapter` serves all nine advertising platforms: they differ by mapping
 * profile and endpoint descriptor, which are configuration, not code. That is what makes "no
 * platform-specific code inside the engine" literally true rather than aspirational.
 */
export function wireTrackingRuntime(input: TrackingRuntimeInput): TrackingRuntime {
  assertFullyWired(input);

  const hasher = new NodeHashPort();
  const credentials = new SecretCredentialResolver(input.secrets);
  const envelopes = new RuntimeTransportEnvelopeFactory(input.idGenerator, () =>
    input.clock.now().getTime(),
  );

  // `conn://` references open from the sealed ad platform vault; every other reference (`vault://…`) goes to
  // the secret provider exactly as before.
  const adapterCredentials: CredentialResolverPort =
    input.connectionCredentials === undefined
      ? credentials
      : new ConnectionCredentialResolver({
          connections: input.connectionCredentials,
          fallback: credentials,
        });

  const httpAdapter = new HttpJsonAdapter({
    http: new FetchHttpTransport(),
    credentials: adapterCredentials,
    envelopes,
    now: () => input.clock.now().getTime(),
  });

  const adapters: AdapterRegistryPort = {
    resolve: (transport) => (transport === "http_json" ? httpAdapter : null),
  };

  const store = new PrismaEventRecordStore(input.db, input.idGenerator);
  const retryPolicy = new RetryPolicy({
    maxAttempts: 5,
    baseDelayMs: 250,
    factor: 2,
    maxDelayMs: 30_000,
  });

  // Process-lifetime, deliberately NOT rebuilt per event: this holds each destination's circuit
  // breaker and token bucket. A fresh instance per event would close every open breaker and refill
  // every bucket on every event — both protections would read as configured and enforce nothing.
  const destinationState = new InMemoryDestinationState();

  // The profile step is stateless apart from its store, so one instance serves every event. A failure inside it
  // never stops an event (the service returns the event unchanged); it is logged by NAME only — a profile row
  // is hashes and ids, and an error message could echo one.
  const profiles: ProfileEnricherPort | undefined =
    input.profiles === undefined
      ? undefined
      : new TrackingProfileService({
          store: input.profiles,
          hasher,
          clock: input.clock,
          ...(input.defaultCountryCode === undefined
            ? {}
            : { defaultCountryCode: input.defaultCountryCode }),
          onError: (error) =>
            input.logger.warn("tracking profile step failed; event delivered unchanged", {
              error: error instanceof Error ? error.name : "unknown",
            }),
        });

  /** Binds the registry-derived ports to one snapshot, for one unit of work. */
  const recordingFor = (snapshot: TrackingRegistrySnapshot): RecordingRuntimeDeps => ({
    delivery: {
      adapters,
      mappings: mappingRegistryOf(snapshot),
      retryPolicy,
      processed: input.processed,
      deadLetters: input.deadLetters,
      now: () => input.clock.now(),
    },
    records: store,
    hasher,
    ...(input.defaultCountryCode === undefined
      ? {}
      : { defaultCountryCode: input.defaultCountryCode }),
    // Destination and mapping versions come from the same snapshot that served the definitions, so
    // the version pinned onto a record is always the version that produced its payload. This is the
    // invariant that pinning protects: reading versions from a snapshot that had been swapped since
    // routing would stamp a record with provenance describing bytes it never produced.
    versions: snapshot,
    destinationState,
    clock: input.clock,
    // Jitter for the first durable retry slot, so a vendor outage's failures do not return in lockstep.
    ...(input.retryQueue === undefined
      ? {}
      : { retryQueue: input.retryQueue, random: Math.random }),
  });

  return {
    ingest: (): IngestRuntimeDeps => {
      // The single read of the handle. Everything below is bound to this one instance.
      const snapshot = input.registry.current();
      return {
        recording: recordingFor(snapshot),
        destinations: snapshot,
        ruleSets: ruleSetRegistryOf(snapshot),
        ruleSetKey: input.ruleSetKey,
        hasher,
        clock: input.clock,
        ...(profiles === undefined ? {} : { profiles }),
        ...(input.consentPolicy === undefined ? {} : { consentPolicy: input.consentPolicy }),
      };
    },
    retry: (): RetryTenantRuntime => {
      const snapshot = input.registry.current();
      return {
        delivery: recordingFor(snapshot).delivery,
        destinations: snapshot,
        destinationState,
        records: store,
      };
    },
    store,
    credentials,
    registry: input.registry,
  };
}

// `replayFor` and the `deriveReplayMetrics` re-export are omitted (P1.3). Both need
// `packages/tracking/src/runtime/{replay-runtime,telemetry}.ts`, which K7 deferred for lack of
// primary-source evidence (`K7_FINAL_RECONCILIATION_REPORT.md`). Nothing on the ingest path calls
// either: `ingest()` above is the whole surface `ingestTrackingEvent` requires. The records this
// runtime writes remain replay-ready — they are the same immutable base-plus-revision rows — so
// replay is re-enabled by adding those two files and this method back, with no data migration.
