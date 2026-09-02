/**
 * Delivery layer (directive §Enforcement, §Retry Engine, §Delivery Metrics).
 *
 * This is the fail-closed gate. **No event reaches a destination without passing** validation →
 * consent → identity stitching → PII hashing → mapping → formatting → routing. Each precondition
 * is re-checked here rather than trusted from an earlier stage: the pipeline is the last place a
 * mistake can be caught, and a silent leak of unhashed PII to a vendor is unrecoverable.
 *
 * Retry, backoff, idempotency and dead-lettering are **composed from `@platform/messaging`**
 * (`RetryPolicy`, `ProcessedEventStore`, `DeadLetterStore`) — none of it is reimplemented.
 *
 * The Delivery Layer owns routing, retry, circuit breaking and **rate limiting**; the Queue owns
 * only scheduling, replay, delay and priority. Outbound order is therefore fixed:
 * **destination → rate limiter → circuit breaker → retry policy → transport.**
 *
 * ## Delivery guarantee
 *
 * This engine provides **at-least-once delivery** with **idempotent processing**, yielding
 * **exactly-once effect**. It does *not* provide exactly-once delivery, which is unachievable
 * across a network: a sender cannot distinguish a lost request from a lost response, so it must
 * either never retry (at-most-once, losing conversions) or retry (at-least-once, risking
 * duplicates). We retry and make duplicates harmless. See {@link DELIVERY_GUARANTEES}.
 */

import type { RetryPolicy } from "@platform/messaging";

import { evaluateConsent } from "../envelope/consent";
import type { EnrichedEnvelope } from "../envelope/envelope";
import { isForwardable } from "../pipeline/hashing";
import { validateDeduplication, validateEnvelope } from "../pipeline/validation";
import {
  type AdapterRegistryPort,
  type DeliveryRequest,
  type DeliveryResponse,
  type DestinationDefinition,
  type RoutingContext,
} from "./destination";
import { applyMapping, type MappingRegistryPort, type TransformRegistryPort } from "./mapping";
import {
  canAttempt,
  consumeToken,
  recordFailure,
  recordSuccess,
  refreshCircuit,
  type CircuitState,
  type RateLimitState,
} from "./resilience";

/** Why an event was refused before any vendor call. Every refusal is terminal and audited. */
export type EnforcementFailure =
  | { readonly gate: "validation"; readonly detail: string }
  | { readonly gate: "consent"; readonly detail: string }
  | { readonly gate: "identity_stitching"; readonly detail: string }
  | { readonly gate: "pii_hashing"; readonly detail: string }
  | { readonly gate: "mapping"; readonly detail: string }
  | { readonly gate: "formatting"; readonly detail: string }
  | { readonly gate: "routing"; readonly detail: string };

export type DeliveryOutcome =
  | { readonly status: "delivered"; readonly attempts: number; readonly latencyMs: number }
  | { readonly status: "skipped_duplicate" }
  | { readonly status: "blocked"; readonly failure: EnforcementFailure }
  | { readonly status: "circuit_open" }
  /** The destination's token bucket is empty. `retryAfterMs` tells the Queue when to reschedule. */
  | { readonly status: "rate_limited"; readonly retryAfterMs: number }
  | { readonly status: "dead_lettered"; readonly attempts: number; readonly error: string };

/**
 * The delivery guarantee this engine provides, stated precisely.
 *
 * True exactly-once *delivery* across a network is impossible — a sender can never distinguish a
 * lost request from a lost response, so it must choose between never retrying (at-most-once) and
 * retrying (at-least-once). We choose at-least-once and make the **effect** idempotent, which is
 * the achievable form of the guarantee.
 */
export const DELIVERY_GUARANTEES = {
  /** Transport may deliver the same event more than once; retries are expected, not exceptional. */
  delivery: "at_least_once",
  /** `ProcessedEventStore.recordIfNew` is an atomic compare-and-set keyed `destination:eventId`. */
  processing: "idempotent",
  /** A duplicate delivery produces no additional effect: the second call is a no-op. */
  effect: "exactly_once",
} as const;

/**
 * The enforcement gate. Runs before any transport work, and returns the **first** breached gate so
 * the failure is attributable to one owner rather than a list.
 */
export function enforceDeliveryPreconditions(
  envelope: EnrichedEnvelope,
  destination: DestinationDefinition,
  now: Date,
): EnforcementFailure | null {
  const validation = validateEnvelope(envelope, { now });
  if (!validation.valid) {
    return { gate: "validation", detail: validation.violations.map((v) => v.field).join(",") };
  }

  const consent = evaluateConsent(envelope.consent, destination.consentPurpose);
  if (!consent.allowed) {
    return { gate: "consent", detail: consent.denial.missing.join(",") };
  }

  const identity = envelope.context.identity;
  if (identity === undefined) {
    return { gate: "identity_stitching", detail: "identity block absent" };
  }

  // The critical one: an identity block that was never hashed must never leave our boundary.
  if (!isForwardable(identity)) {
    return { gate: "pii_hashing", detail: `hashStatus=${identity.hashStatus ?? "unset"}` };
  }

  const dedup = validateDeduplication(envelope);
  if (!dedup.valid) {
    return { gate: "routing", detail: "dedupId missing" };
  }

  return null;
}

/** Counters emitted per destination. Analytics owns the metric definitions; tracking only emits. */
export interface DeliveryMetrics {
  readonly destination: string;
  readonly eventsReceived: number;
  readonly eventsRouted: number;
  readonly eventsDelivered: number;
  readonly retryCount: number;
  readonly failureCount: number;
  readonly dropCount: number;
  readonly consentBlockCount: number;
  readonly validationFailureCount: number;
  /** Attempts refused by the destination's token bucket, before any transport call. */
  readonly rateLimitedCount: number;
  readonly destinationLatencyMs: number;
  readonly deliveryLatencyMs: number;
}

export const ZERO_METRICS: Omit<DeliveryMetrics, "destination"> = {
  eventsReceived: 0,
  eventsRouted: 0,
  eventsDelivered: 0,
  retryCount: 0,
  failureCount: 0,
  dropCount: 0,
  consentBlockCount: 0,
  validationFailureCount: 0,
  rateLimitedCount: 0,
  destinationLatencyMs: 0,
  deliveryLatencyMs: 0,
};

/** Emission port. Tracking pushes counters; Analytics defines and aggregates them. */
export interface DeliveryMetricsPort {
  emit(metrics: DeliveryMetrics): void;
}

/** Health snapshot per destination (directive §Destination Health). */
export interface DestinationHealth {
  readonly destination: string;
  readonly status: "healthy" | "degraded" | "unavailable";
  readonly lastDeliveryAt?: string;
  readonly successRate: number;
  readonly failureRate: number;
  readonly latencyMs: number;
  readonly queueSize: number;
  readonly retryQueueSize: number;
  readonly circuitStatus: CircuitState["status"];
}

export interface DeliveryDeps {
  readonly adapters: AdapterRegistryPort;
  readonly mappings: MappingRegistryPort;
  readonly transforms?: TransformRegistryPort;
  readonly retryPolicy: RetryPolicy;
  /** Idempotency guard from `@platform/messaging` — makes redelivery exactly-once in effect. */
  readonly processed: {
    recordIfNew(messageId: string, processedAt: string): Promise<boolean>;
  };
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
  readonly metrics?: DeliveryMetricsPort;
  /** Injected so backoff is testable without real waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

export interface DeliverInput {
  readonly envelope: EnrichedEnvelope;
  readonly destination: DestinationDefinition;
  readonly routingContext: RoutingContext;
  readonly circuit: CircuitState;
  /** Per-destination token bucket. Held by the caller so `deliver` stays a pure state transition. */
  readonly rateLimit: RateLimitState;
  /**
   * A payload already rendered by {@link renderPayload}. Supplied by the recording runtime (M6),
   * which must map **before** it appends the event record so the bytes it persists are the exact
   * bytes transmitted. When present, mapping is skipped rather than re-run: re-mapping here could
   * produce a different payload than the one recorded, and the record would then describe an event
   * that never happened.
   */
  readonly renderedPayload?: Readonly<Record<string, unknown>>;
}

/** A payload rendered for one destination, or the gate that refused to render it. */
export type RenderOutcome =
  | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly failure: EnforcementFailure };

/**
 * The **Map** phase, extracted so it can run independently of transmission.
 *
 * Delivery used to map inline, which made "append the record before delivering" impossible: the
 * payload did not exist until the vendor call was already underway. Callers that need the payload
 * first (the recording runtime) render here and pass the result into {@link deliver}; callers that
 * do not are unaffected, since `deliver` still renders on their behalf.
 */
export function renderPayload(
  deps: Pick<DeliveryDeps, "mappings" | "transforms">,
  destination: DestinationDefinition,
  routingContext: RoutingContext,
): RenderOutcome {
  const profile = deps.mappings.resolve(destination.mappingProfileKey);
  if (profile === null) {
    return {
      ok: false,
      failure: { gate: "mapping", detail: `profile ${destination.mappingProfileKey} unresolved` },
    };
  }

  const mapped = applyMapping(profile, routingContext, deps.transforms);
  if (!mapped.ok) {
    return {
      ok: false,
      failure: { gate: "mapping", detail: mapped.failures.map((f) => f.target).join(",") },
    };
  }

  return { ok: true, payload: mapped.payload };
}

export interface DeliveryResult {
  readonly outcome: DeliveryOutcome;
  readonly circuit: CircuitState;
  readonly rateLimit: RateLimitState;
  readonly metrics: DeliveryMetrics;
}

/**
 * Delivers one event to one destination.
 *
 * Order is fixed: **destination → rate limiter → circuit breaker → retry policy → transport.**
 * The rate limiter runs first because a token refused costs nothing, while probing a vendor we are
 * already over quota with earns a 429 that then trips the breaker — punishing the destination for
 * our own pacing failure.
 *
 * **Delivery guarantee (see {@link DELIVERY_GUARANTEES}): at-least-once delivery with idempotent
 * processing, giving exactly-once *effect*.** Not exactly-once delivery, which is unachievable
 * across a network.
 *
 * Idempotency is keyed by `destination:eventId` — not by `dedupId`. `dedupId` is intentionally
 * shared by the browser and server copies, so keying on it would suppress the authoritative server
 * event whenever the browser copy arrived first (D-077).
 */
export async function deliver(deps: DeliveryDeps, input: DeliverInput): Promise<DeliveryResult> {
  const now = deps.now ?? ((): Date => new Date());
  const sleep =
    deps.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const startedAt = now().getTime();

  let metrics: DeliveryMetrics = {
    ...ZERO_METRICS,
    destination: input.destination.key,
    eventsReceived: 1,
  };
  let rateLimit = input.rateLimit;

  // --- Enforcement gate (fail closed) ---
  const breach = enforceDeliveryPreconditions(input.envelope, input.destination, now());
  if (breach !== null) {
    metrics = {
      ...metrics,
      dropCount: 1,
      consentBlockCount: breach.gate === "consent" ? 1 : 0,
      validationFailureCount: breach.gate === "validation" ? 1 : 0,
    };
    deps.metrics?.emit(metrics);
    return {
      outcome: { status: "blocked", failure: breach },
      circuit: input.circuit,
      rateLimit,
      metrics,
    };
  }

  // --- Rate limiter (before the breaker: see the ordering note above) ---
  const limitDescriptor = input.destination.rateLimit;
  if (limitDescriptor !== undefined) {
    const decision = consumeToken(rateLimit, limitDescriptor, startedAt);
    rateLimit = decision.state;

    if (!decision.allowed) {
      // Not a failure — the event is deferred, not dropped. The Queue owns rescheduling, so it is
      // told exactly how long to wait rather than left to guess.
      metrics = { ...metrics, rateLimitedCount: 1 };
      deps.metrics?.emit(metrics);
      return {
        outcome: { status: "rate_limited", retryAfterMs: decision.retryAfterMs },
        circuit: input.circuit,
        rateLimit,
        metrics,
      };
    }
  }

  // --- Circuit breaker ---
  const circuit = refreshCircuit(input.circuit, startedAt);
  if (!canAttempt(circuit, startedAt)) {
    metrics = { ...metrics, dropCount: 1 };
    deps.metrics?.emit(metrics);
    return { outcome: { status: "circuit_open" }, circuit, rateLimit, metrics };
  }

  // --- Exactly-once: a redelivery of the same event to the same destination is a no-op ---
  const idempotencyKey = `${input.destination.key}:${input.envelope.eventId}`;
  const isNew = await deps.processed.recordIfNew(idempotencyKey, now().toISOString());
  if (!isNew) {
    deps.metrics?.emit(metrics);
    return { outcome: { status: "skipped_duplicate" }, circuit, rateLimit, metrics };
  }

  // --- Mapping + formatting ---
  // A payload rendered by the caller is used verbatim; otherwise it is rendered here. Both paths go
  // through `renderPayload`, so there is exactly one mapping implementation.
  let payload: Readonly<Record<string, unknown>>;

  if (input.renderedPayload === undefined) {
    const rendered = renderPayload(deps, input.destination, input.routingContext);
    if (!rendered.ok) {
      metrics = { ...metrics, dropCount: 1 };
      deps.metrics?.emit(metrics);
      return {
        outcome: { status: "blocked", failure: rendered.failure },
        circuit,
        rateLimit,
        metrics,
      };
    }
    payload = rendered.payload;
  } else {
    payload = input.renderedPayload;
  }

  const adapter = deps.adapters.resolve(input.destination.transport);
  if (adapter === null) {
    metrics = { ...metrics, dropCount: 1 };
    deps.metrics?.emit(metrics);
    return {
      outcome: {
        status: "blocked",
        failure: { gate: "formatting", detail: `no adapter for ${input.destination.transport}` },
      },
      circuit,
      rateLimit,
      metrics,
    };
  }

  const request: DeliveryRequest = {
    destination: input.destination.key,
    endpoint: input.destination.endpoint,
    payload,
    dedupId: input.envelope.dedupId,
    eventId: input.envelope.eventId,
  };

  // --- Attempt loop: backoff comes from messaging's RetryPolicy ---
  let attempts = 0;
  let circuitState = circuit;
  let lastError = "unknown";
  let lastResponse: DeliveryResponse | undefined;

  metrics = { ...metrics, eventsRouted: 1 };

  while (attempts < deps.retryPolicy.maxAttempts) {
    attempts += 1;

    const response = await adapter.send(request);
    lastResponse = response;

    if (response.ok) {
      const finishedAt = now().getTime();
      circuitState = recordSuccess(circuitState, breakerFor(input.destination), finishedAt);
      metrics = {
        ...metrics,
        eventsDelivered: 1,
        retryCount: attempts - 1,
        destinationLatencyMs: response.latencyMs,
        deliveryLatencyMs: finishedAt - startedAt,
      };
      deps.metrics?.emit(metrics);
      return {
        outcome: { status: "delivered", attempts, latencyMs: response.latencyMs },
        circuit: circuitState,
        rateLimit,
        metrics,
      };
    }

    lastError = response.error ?? `status ${String(response.statusCode ?? 0)}`;
    circuitState = recordFailure(circuitState, breakerFor(input.destination), now().getTime());

    // A permanent vendor rejection (bad payload, revoked token) will never succeed on retry —
    // retrying it only burns rate limit and delays the dead-letter that a human must act on.
    if (!response.retryable) break;
    if (attempts >= deps.retryPolicy.maxAttempts) break;

    // Each retry is a separate vendor request, so it needs its own token. When the bucket is dry
    // the wait is extended to cover the refill rather than the attempt being abandoned — the event
    // is already in flight and dropping it here would lose a conversion to our own pacing.
    let backoffMs = deps.retryPolicy.delayForAttempt(attempts);

    if (limitDescriptor !== undefined) {
      const probe = consumeToken(rateLimit, limitDescriptor, now().getTime());

      if (probe.allowed) {
        rateLimit = probe.state;
      } else {
        backoffMs = Math.max(backoffMs, probe.retryAfterMs);
        rateLimit = probe.state;
        metrics = { ...metrics, rateLimitedCount: metrics.rateLimitedCount + 1 };
        await sleep(backoffMs);

        // The wait was sized so the bucket has refilled; this consume is expected to succeed.
        const afterWait = consumeToken(rateLimit, limitDescriptor, now().getTime() + backoffMs);
        rateLimit = afterWait.state;
        continue;
      }
    }

    await sleep(backoffMs);
  }

  await deps.deadLetters.add({
    messageId: input.envelope.eventId,
    topic: `tracking.delivery.${input.destination.key}`,
    value: encodePayload(payload),
    headers: {
      destination: input.destination.key,
      dedupId: input.envelope.dedupId,
      tenantId: input.envelope.tenancy.tenantId,
    },
    attempts,
    error: lastError,
    failedAt: now().toISOString(),
  });

  metrics = {
    ...metrics,
    failureCount: 1,
    retryCount: Math.max(0, attempts - 1),
    destinationLatencyMs: lastResponse?.latencyMs ?? 0,
    deliveryLatencyMs: now().getTime() - startedAt,
  };
  deps.metrics?.emit(metrics);

  return {
    outcome: { status: "dead_lettered", attempts, error: lastError },
    circuit: circuitState,
    rateLimit,
    metrics,
  };
}

function breakerFor(destination: DestinationDefinition): {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccesses: number;
} {
  return (
    destination.circuitBreaker ?? {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenSuccesses: 2,
    }
  );
}

/** Encodes the payload for dead-letter storage, preserving it verbatim for byte-identical replay. */
function encodePayload(payload: Readonly<Record<string, unknown>>): Uint8Array {
  const json = JSON.stringify(payload);
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i += 1) bytes[i] = json.charCodeAt(i) & 0xff;
  return bytes;
}

/** Derives a health snapshot from accumulated counters. */
export function deriveHealth(input: {
  readonly destination: string;
  readonly delivered: number;
  readonly failed: number;
  readonly latencyMs: number;
  readonly queueSize: number;
  readonly retryQueueSize: number;
  readonly circuit: CircuitState;
  readonly lastDeliveryAt?: string;
}): DestinationHealth {
  const total = input.delivered + input.failed;
  const successRate = total === 0 ? 1 : input.delivered / total;

  const status: DestinationHealth["status"] =
    input.circuit.status === "open"
      ? "unavailable"
      : successRate < 0.95 || input.circuit.status === "half_open"
        ? "degraded"
        : "healthy";

  return {
    destination: input.destination,
    status,
    ...(input.lastDeliveryAt === undefined ? {} : { lastDeliveryAt: input.lastDeliveryAt }),
    successRate: Number(successRate.toFixed(4)),
    failureRate: Number((1 - successRate).toFixed(4)),
    latencyMs: input.latencyMs,
    queueSize: input.queueSize,
    retryQueueSize: input.retryQueueSize,
    circuitStatus: input.circuit.status,
  };
}
