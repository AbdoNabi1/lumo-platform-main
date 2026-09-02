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

import type { IdGenerator } from "@platform/contracts";
import type { Database } from "@platform/db";
import type { SecretProvider } from "@platform/secrets";
import type { Logger } from "@platform/utils";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  type AdapterRegistryPort,
  type IngestRuntimeDeps,
  type RecordingRuntimeDeps,
} from "@platform/tracking";

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

  const httpAdapter = new HttpJsonAdapter({
    http: new FetchHttpTransport(),
    credentials,
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
    // Destination and mapping versions come from the same snapshot that served the definitions, so
    // the version pinned onto a record is always the version that produced its payload. This is the
    // invariant that pinning protects: reading versions from a snapshot that had been swapped since
    // routing would stamp a record with provenance describing bytes it never produced.
    versions: snapshot,
    destinationState,
    clock: input.clock,
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
