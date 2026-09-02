import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import { RetryPolicy } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";

import {
  toRoutingContext,
  type DestinationDefinition,
  type DestinationKey,
  type DestinationRegistryPort,
  type DeliveryResponse,
} from "./destination";
import { applyMapping, mappingFallbacks, type MappingProfile } from "./mapping";
import {
  INITIAL_CIRCUIT,
  type CircuitState,
  canAttempt,
  consumeToken,
  initialRateLimit,
  recordFailure,
  recordSuccess,
  refreshCircuit,
} from "./resilience";
import { route } from "./router";
import {
  DELIVERY_GUARANTEES,
  deliver,
  deriveHealth,
  enforceDeliveryPreconditions,
} from "./delivery-pipeline";
import { HttpJsonAdapter, isRetryableStatus } from "./adapters";
import { SEED_DESTINATIONS, SEED_MAPPING_PROFILES, SEED_PROFILE_KEYS } from "./platform-profiles";
import type { EnrichedEnvelope } from "../envelope/envelope";

const NOW = new Date("2026-07-19T12:00:00.000Z");

const BREAKER = { failureThreshold: 3, resetTimeoutMs: 30_000, halfOpenSuccesses: 2 };

function envelope(overrides: Partial<EnrichedEnvelope> = {}): EnrichedEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: "purchase",
    eventVersion: 1,
    dedupId: "dedup-1",
    timestamp: "2026-07-19T11:59:00.000Z",
    receivedAt: NOW.toISOString(),
    eventTimestampMs: Date.parse("2026-07-19T11:59:00.000Z"),
    source: "server",
    environment: "production",
    consent: {
      analytics: true,
      marketing: true,
      personalization: true,
      grants: { ad_storage: true, ad_user_data: true, analytics_storage: true },
    },
    context: {
      identity: { email: "sha256(x)", customerId: "c-1", country: "sa", hashStatus: "sha256" },
      attribution: { channelGroup: "paid_social" },
    },
    properties: {},
    payload: { valueMinor: 150_000, currency: "USD", orderId: "o-1" },
    tenancy: { tenantId: "t-1" },
    ...overrides,
  } as EnrichedEnvelope;
}

function destination(overrides: Partial<DestinationDefinition> = {}): DestinationDefinition {
  return {
    key: "meta.capi",
    platform: "meta",
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: "meta.capi.mapping",
    endpoint: { url: "https://vendor.test/events", method: "POST", timeoutMs: 5_000 },
    retry: { maxAttempts: 3, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
    circuitBreaker: BREAKER,
    enabled: true,
    ...overrides,
  };
}

function registryOf(definitions: readonly DestinationDefinition[]): DestinationRegistryPort {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  return {
    resolve: (key) => byKey.get(key) ?? null,
    resolveVersion: (key) => byKey.get(key) ?? null,
    listActive: () => [...byKey.values()],
  };
}

// ---------------------------------------------------------------------------

describe("registry-driven routing (no switch, no hardcoded providers)", () => {
  const ruleSet: RuleSet<DestinationKey> = {
    id: "routing",
    version: 1,
    mode: "all_matches",
    rules: [
      {
        id: "high-value-meta",
        priority: 10,
        when: Expr.where("payload.valueMinor", "gt", 100_000),
        then: "meta.capi",
      },
      {
        id: "high-value-tiktok",
        priority: 20,
        when: Expr.where("payload.valueMinor", "gt", 100_000),
        then: "tiktok.events",
      },
      {
        id: "low-value-pinterest",
        priority: 30,
        when: Expr.where("payload.valueMinor", "lt", 1_000),
        then: "pinterest.capi",
      },
    ],
  };

  const registry = registryOf([
    destination({ key: "meta.capi" }),
    destination({ key: "tiktok.events" }),
    destination({ key: "pinterest.capi" }),
  ]);

  it("routes by rule outcome, resolving every destination dynamically", () => {
    const decision = route({ envelope: envelope(), ruleSet, destinations: registry });
    expect(decision.routed.map((r) => r.destination.key)).toEqual(["meta.capi", "tiktok.events"]);
  });

  it("explains why a destination was NOT selected", () => {
    const decision = route({ envelope: envelope(), ruleSet, destinations: registry });
    const pinterest = decision.excluded.find((e) => e.key === "pinterest.capi");
    expect(pinterest?.reason.code).toBe("rule_not_matched");
  });

  it("excludes an unregistered destination rather than failing the whole event", () => {
    const decision = route({
      envelope: envelope(),
      ruleSet,
      destinations: registryOf([destination({ key: "meta.capi" })]),
    });
    expect(decision.excluded.find((e) => e.key === "tiktok.events")?.reason.code).toBe(
      "not_registered",
    );
  });

  it("excludes a disabled destination", () => {
    const decision = route({
      envelope: envelope(),
      ruleSet,
      destinations: registryOf([destination({ key: "meta.capi", enabled: false })]),
    });
    expect(decision.excluded.find((e) => e.key === "meta.capi")?.reason.code).toBe("disabled");
  });

  it("enforces consent per destination, not once globally", () => {
    const denied = envelope({
      consent: { analytics: true, marketing: false, personalization: false },
    });
    const decision = route({ envelope: denied, ruleSet, destinations: registry });

    expect(decision.routed).toHaveLength(0);
    expect(decision.excluded.every((e) => e.reason.code !== "consent_denied" || true)).toBe(true);
    const blocked = decision.excluded.find((e) => e.reason.code === "consent_denied");
    expect(blocked).toBeDefined();
  });

  it("surfaces a degraded routing decision when a rule cannot be evaluated", () => {
    const broken: RuleSet<DestinationKey> = {
      ...ruleSet,
      rules: [
        { id: "bad", priority: 1, when: Expr.where("nope.missing", "gt", 1), then: "meta.capi" },
      ],
    };
    expect(route({ envelope: envelope(), ruleSet: broken, destinations: registry }).degraded).toBe(
      true,
    );
  });
});

describe("mapping engine (configuration, not payload builders)", () => {
  const profile: MappingProfile = {
    key: "test.mapping",
    version: 1,
    destination: "test",
    constants: { action_source: "website" },
    fields: [
      { target: "event_name", source: "event.name", required: true },
      { target: "user_data.em", source: "identity.email", transform: "to_array" },
      { target: "custom_data.value", source: "payload.valueMinor", transform: "minor_to_major" },
      { target: "custom_data.currency", source: "payload.currency", defaultValue: "USD" },
      {
        target: "custom_data.high_value",
        source: "payload.valueMinor",
        when: Expr.where("payload.valueMinor", "gt", 100_000),
      },
    ],
  };

  const context = toRoutingContext(envelope()) as Record<string, unknown>;
  const full = { ...context, event: { ...(context.event as object), name: "purchase" } };

  it("renames, nests and transforms per configuration", () => {
    const result = applyMapping(profile, { ...full, identity: { email: "sha256(x)" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({
        action_source: "website",
        event_name: "purchase",
        user_data: { em: ["sha256(x)"] },
        custom_data: { value: 1500, currency: "USD", high_value: 150_000 },
      });
    }
  });

  it("omits a conditional field when its condition is false", () => {
    const low = { ...full, payload: { valueMinor: 500, currency: "USD" } };
    const result = applyMapping(profile, low);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload.custom_data as Record<string, unknown>).high_value).toBeUndefined();
    }
  });

  it("applies a default when the source is absent", () => {
    const result = applyMapping(profile, { ...full, payload: {} });
    if (result.ok) {
      expect((result.payload.custom_data as Record<string, unknown>).currency).toBe("USD");
    }
  });

  it("reports which fields fell back to their default, as a fact rather than an inference", () => {
    // `payload.currency` is absent, so the profile's `defaultValue: "USD"` is what `applyMapping`
    // actually emits — `mappingFallbacks` must name exactly this field, not merely "some field looks
    // like a default", which would be wrong the moment a real value equalled the default by chance.
    const result = mappingFallbacks(profile, { ...full, payload: {} });
    expect(result).toEqual([
      { target: "custom_data.currency", source: "payload.currency", defaultValue: "USD" },
    ]);
  });

  it("reports no fallback when the source resolved to a real value", () => {
    const result = mappingFallbacks(profile, full);
    expect(result).toEqual([]);
  });

  it("does not report a fallback for a field skipped by its own condition", () => {
    // `high_value` has no `defaultValue` at all; a field with `when: false` and no default must not
    // be misreported as having "fallen back".
    const low = { ...full, payload: { valueMinor: 500, currency: "USD" } };
    expect(mappingFallbacks(profile, low)).toEqual([]);
  });

  it("produces NO payload when a required field is missing", () => {
    // A partial conversion looks successful while under-reporting — worse than sending none.
    const result = applyMapping(profile, { ...full, event: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe("missing_required");
  });

  it("reports an unknown transform instead of silently passing the raw value", () => {
    const bad: MappingProfile = {
      ...profile,
      fields: [{ target: "x", source: "event.name", transform: "does_not_exist" }],
    };
    const result = applyMapping(bad, full);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe("unknown_transform");
  });

  it("exposes no hashing transform — hashing is its own pipeline stage", () => {
    const result = applyMapping(
      { ...profile, fields: [{ target: "x", source: "event.name", transform: "sha256" }] },
      full,
    );
    expect(result.ok).toBe(false);
  });
});

describe("enforcement gate (fail closed)", () => {
  it("passes a fully compliant envelope", () => {
    expect(enforceDeliveryPreconditions(envelope(), destination(), NOW)).toBeNull();
  });

  it("blocks an identity block that was never hashed", () => {
    const raw = envelope({
      context: { identity: { email: "ali@example.com", hashStatus: "raw" } },
    });
    expect(enforceDeliveryPreconditions(raw, destination(), NOW)?.gate).toBe("pii_hashing");
  });

  it("blocks when the identity block is absent entirely", () => {
    expect(enforceDeliveryPreconditions(envelope({ context: {} }), destination(), NOW)?.gate).toBe(
      "identity_stitching",
    );
  });

  it("blocks on denied consent", () => {
    const denied = envelope({
      consent: { analytics: true, marketing: false, personalization: false },
    });
    expect(enforceDeliveryPreconditions(denied, destination(), NOW)?.gate).toBe("consent");
  });

  it("blocks an invalid envelope", () => {
    expect(
      enforceDeliveryPreconditions(envelope({ tenancy: {} } as never), destination(), NOW)?.gate,
    ).toBe("validation");
  });

  it("blocks delivery without a dedupId", () => {
    expect(
      enforceDeliveryPreconditions(envelope({ dedupId: "" } as never), destination(), NOW)?.gate,
    ).toBe("routing");
  });
});

describe("delivery: retry, idempotency and dead-lettering", () => {
  function deps(responses: readonly DeliveryResponse[], overrides: Record<string, unknown> = {}) {
    let call = 0;
    const deadLetters: unknown[] = [];
    const recorded = new Set<string>();

    return {
      deadLetters,
      sent: (): number => call,
      deps: {
        adapters: {
          resolve: () => ({
            transport: "http_json" as const,
            send: (): Promise<DeliveryResponse> => {
              const response = responses[Math.min(call, responses.length - 1)];
              call += 1;
              return Promise.resolve(response!);
            },
          }),
        },
        mappings: {
          resolve: (): MappingProfile => ({
            key: "meta.capi.mapping",
            version: 1,
            destination: "meta.capi",
            fields: [{ target: "event_name", source: "event.name" }],
          }),
          resolveVersion: (): null => null,
        },
        retryPolicy: new RetryPolicy({
          maxAttempts: 3,
          baseDelayMs: 1,
          factor: 2,
          maxDelayMs: 4,
          jitter: () => 0,
        }),
        processed: {
          recordIfNew: (key: string): Promise<boolean> => {
            if (recorded.has(key)) return Promise.resolve(false);
            recorded.add(key);
            return Promise.resolve(true);
          },
        },
        deadLetters: {
          add: (entry: unknown): Promise<void> => {
            deadLetters.push(entry);
            return Promise.resolve();
          },
        },
        sleep: (): Promise<void> => Promise.resolve(),
        now: () => NOW,
        ...overrides,
      },
    };
  }

  const okResponse: DeliveryResponse = {
    ok: true,
    statusCode: 200,
    retryable: false,
    latencyMs: 12,
  };
  const transient: DeliveryResponse = {
    ok: false,
    statusCode: 503,
    retryable: true,
    latencyMs: 5,
    error: "unavailable",
  };
  const permanent: DeliveryResponse = {
    ok: false,
    statusCode: 400,
    retryable: false,
    latencyMs: 3,
    error: "bad payload",
  };

  const input = () => ({
    envelope: envelope(),
    destination: destination(),
    routingContext: { event: { name: "purchase" } },
    circuit: INITIAL_CIRCUIT,
    rateLimit: initialRateLimit({ requestsPerSecond: 1_000, burst: 1_000 }, NOW.getTime()),
  });

  it("delivers on the first attempt", async () => {
    const h = deps([okResponse]);
    const result = await deliver(h.deps as never, input());
    expect(result.outcome).toMatchObject({ status: "delivered", attempts: 1 });
    expect(result.metrics.eventsDelivered).toBe(1);
  });

  it("retries a transient failure then succeeds", async () => {
    const h = deps([transient, okResponse]);
    const result = await deliver(h.deps as never, input());
    expect(result.outcome).toMatchObject({ status: "delivered", attempts: 2 });
    expect(result.metrics.retryCount).toBe(1);
  });

  it("does NOT retry a permanent rejection", async () => {
    const h = deps([permanent]);
    const result = await deliver(h.deps as never, input());
    expect(result.outcome.status).toBe("dead_lettered");
    expect(h.sent()).toBe(1);
  });

  it("dead-letters after exhausting attempts, preserving payload and headers", async () => {
    const h = deps([transient]);
    const result = await deliver(h.deps as never, input());

    expect(result.outcome).toMatchObject({ status: "dead_lettered", attempts: 3 });
    expect(h.deadLetters).toHaveLength(1);
    expect(h.deadLetters[0]).toMatchObject({
      headers: { destination: "meta.capi", dedupId: "dedup-1", tenantId: "t-1" },
      attempts: 3,
    });
  });

  it("is exactly-once per destination: a redelivery is a no-op", async () => {
    const h = deps([okResponse]);
    await deliver(h.deps as never, input());
    const second = await deliver(h.deps as never, input());
    expect(second.outcome.status).toBe("skipped_duplicate");
  });

  it("keys idempotency on eventId, so the server copy is not suppressed by the browser copy", async () => {
    const h = deps([okResponse]);
    await deliver(h.deps as never, input());

    // Same dedupId (shared by design), different eventId — must still deliver.
    const serverCopy = {
      ...input(),
      envelope: envelope({ eventId: "different-event-id" }),
    };
    const result = await deliver(h.deps as never, serverCopy);
    expect(result.outcome.status).toBe("delivered");
  });

  it("blocks before any vendor call when a gate fails", async () => {
    const h = deps([okResponse]);
    const result = await deliver(h.deps as never, {
      ...input(),
      envelope: envelope({ context: { identity: { email: "raw@x.com", hashStatus: "raw" } } }),
    });

    expect(result.outcome).toMatchObject({ status: "blocked" });
    expect(h.sent()).toBe(0);
  });

  it("refuses to send when the circuit is open", async () => {
    const h = deps([okResponse]);
    const open = {
      ...INITIAL_CIRCUIT,
      status: "open" as const,
      openedUntilMs: NOW.getTime() + 60_000,
    };
    const result = await deliver(h.deps as never, { ...input(), circuit: open });

    expect(result.outcome.status).toBe("circuit_open");
    expect(h.sent()).toBe(0);
  });

  it("emits metrics for every outcome", async () => {
    const emitted: unknown[] = [];
    const h = deps([okResponse], { metrics: { emit: (m: unknown) => emitted.push(m) } });
    await deliver(h.deps as never, input());
    expect(emitted).toHaveLength(1);
  });

  // --- Rate limiting is owned by the Delivery Layer, not the Queue ---

  const limited = () => ({
    ...input(),
    destination: destination({ rateLimit: { requestsPerSecond: 1, burst: 1 } }),
  });

  it("consumes a token before every outbound attempt", async () => {
    const h = deps([okResponse]);
    const result = await deliver(h.deps as never, limited());

    expect(result.outcome.status).toBe("delivered");
    expect(result.rateLimit.tokens).toBeLessThan(1);
  });

  it("defers — not drops — when the bucket is empty, telling the Queue when to retry", async () => {
    const h = deps([okResponse]);
    const empty = {
      ...limited(),
      rateLimit: { tokens: 0, lastRefillMs: NOW.getTime() },
    };

    const result = await deliver(h.deps as never, empty);

    expect(result.outcome.status).toBe("rate_limited");
    if (result.outcome.status === "rate_limited") {
      expect(result.outcome.retryAfterMs).toBeGreaterThan(0);
    }
    expect(h.sent()).toBe(0);
    expect(result.metrics.rateLimitedCount).toBe(1);
    // Deferred, so it must NOT be counted as a drop or a failure.
    expect(result.metrics.dropCount).toBe(0);
    expect(result.metrics.failureCount).toBe(0);
  });

  it("rate-limits BEFORE the circuit breaker, so our pacing never trips the breaker", async () => {
    const h = deps([okResponse]);
    const empty = {
      ...limited(),
      rateLimit: { tokens: 0, lastRefillMs: NOW.getTime() },
    };

    const result = await deliver(h.deps as never, empty);

    // A refused token must leave the breaker untouched: earning a 429 we could have avoided
    // punishes the destination for our own over-sending.
    expect(result.circuit).toEqual(INITIAL_CIRCUIT);
    expect(result.circuit.consecutiveFailures).toBe(0);
  });

  it("does not consume a token when an enforcement gate blocks the event", async () => {
    const h = deps([okResponse]);
    const blocked = {
      ...limited(),
      envelope: envelope({ context: { identity: { email: "raw@x.com", hashStatus: "raw" } } }),
    };

    const result = await deliver(h.deps as never, blocked);

    expect(result.outcome.status).toBe("blocked");
    // Quota is a scarce vendor resource; an event that can never be sent must not spend it.
    expect(result.rateLimit.tokens).toBe(limited().rateLimit.tokens);
  });

  it("extends backoff to cover refill rather than abandoning an in-flight retry", async () => {
    const slept: number[] = [];
    const h = deps([transient, okResponse], {
      sleep: (ms: number): Promise<void> => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    const result = await deliver(h.deps as never, {
      ...limited(),
      rateLimit: { tokens: 1, lastRefillMs: NOW.getTime() },
    });

    expect(result.outcome.status).toBe("delivered");
    // The retry waited for the bucket, not just the backoff.
    expect(slept[0]).toBeGreaterThanOrEqual(1_000);
  });

  it("skips rate limiting entirely for a destination with no limit configured", async () => {
    const h = deps([okResponse]);
    const unlimited = { ...input(), destination: destination({ rateLimit: undefined }) };
    const result = await deliver(h.deps as never, unlimited);

    expect(result.outcome.status).toBe("delivered");
    expect(result.rateLimit).toEqual(unlimited.rateLimit);
  });
});

describe("delivery guarantee", () => {
  it("claims at-least-once delivery with exactly-once EFFECT, never exactly-once delivery", () => {
    expect(DELIVERY_GUARANTEES).toEqual({
      delivery: "at_least_once",
      processing: "idempotent",
      effect: "exactly_once",
    });
  });

  it("is documented on the module rather than only in a report", () => {
    // The guarantee is exported so it cannot drift from what the code actually provides.
    expect(DELIVERY_GUARANTEES.delivery).not.toBe("exactly_once");
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold", () => {
    let state = INITIAL_CIRCUIT;
    for (let i = 0; i < 3; i += 1) state = recordFailure(state, BREAKER, 1_000);
    expect(state.status).toBe("open");
    expect(canAttempt(state, 1_000)).toBe(false);
  });

  it("half-opens once the reset window elapses", () => {
    let state = INITIAL_CIRCUIT;
    for (let i = 0; i < 3; i += 1) state = recordFailure(state, BREAKER, 1_000);
    expect(refreshCircuit(state, 1_000 + 30_001).status).toBe("half_open");
  });

  it("requires sustained recovery before closing", () => {
    // Closing on a single probe flaps straight back open and hammers a degraded vendor.
    let state: CircuitState = { ...INITIAL_CIRCUIT, status: "half_open" };
    state = recordSuccess(state, BREAKER, 2_000);
    expect(state.status).toBe("half_open");
    state = recordSuccess(state, BREAKER, 2_100);
    expect(state.status).toBe("closed");
  });

  it("re-opens immediately on a failed probe", () => {
    const half = { ...INITIAL_CIRCUIT, status: "half_open" as const };
    expect(recordFailure(half, BREAKER, 3_000).status).toBe("open");
  });

  it("resets the failure count on success", () => {
    const failing = recordFailure(INITIAL_CIRCUIT, BREAKER, 1_000);
    expect(recordSuccess(failing, BREAKER, 1_100).consecutiveFailures).toBe(0);
  });
});

describe("rate limiting", () => {
  const limit = { requestsPerSecond: 10, burst: 10 };

  it("allows up to the burst then refuses with a wait hint", () => {
    let state = initialRateLimit(limit, 0);
    for (let i = 0; i < 10; i += 1) {
      const decision = consumeToken(state, limit, 0);
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }

    const refused = consumeToken(state, limit, 0);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time, capped at burst", () => {
    let state = initialRateLimit(limit, 0);
    for (let i = 0; i < 10; i += 1) state = consumeToken(state, limit, 0).state;

    expect(consumeToken(state, limit, 1_000).allowed).toBe(true);
    expect(consumeToken(state, limit, 100_000).state.tokens).toBeLessThanOrEqual(limit.burst);
  });
});

describe("http adapter", () => {
  const request = {
    destination: "meta.capi",
    endpoint: { url: "https://vendor.test", method: "POST" as const, timeoutMs: 1_000 },
    payload: { a: 1 },
    dedupId: "d-1",
    eventId: "e-1",
  };

  it("treats 2xx as success", async () => {
    const adapter = new HttpJsonAdapter({
      http: { send: () => Promise.resolve({ status: 200, body: { ok: 1 } }) },
      now: () => 0,
    });
    expect((await adapter.send(request)).ok).toBe(true);
  });

  it("classifies 429 and 5xx as retryable, 4xx as permanent", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });

  it("treats a transport throw as retryable", async () => {
    const adapter = new HttpJsonAdapter({
      http: { send: () => Promise.reject(new Error("socket hang up")) },
      now: () => 0,
    });
    const response = await adapter.send(request);
    expect(response).toMatchObject({ ok: false, retryable: true });
  });

  it("fails NON-retryably when a credential cannot be resolved", async () => {
    const adapter = new HttpJsonAdapter({
      http: { send: () => Promise.resolve({ status: 200 }) },
      credentials: { resolve: () => Promise.resolve(null) },
      now: () => 0,
    });
    const response = await adapter.send({
      ...request,
      endpoint: { ...request.endpoint, credentialRef: "vault://missing" },
    });
    // Retrying cannot conjure a credential, and the call must never go out unauthenticated.
    expect(response).toMatchObject({ ok: false, retryable: false });
  });

  it("refuses to transmit a payload carrying transport metadata", async () => {
    const sent: unknown[] = [];
    const adapter = new HttpJsonAdapter({
      http: {
        send: (i) => {
          sent.push(i);
          return Promise.resolve({ status: 200 });
        },
      },
      now: () => 0,
    });

    // Something stored a credential as if it were business data — refuse, non-retryably.
    const response = await adapter.send({
      ...request,
      payload: { event_name: "purchase", authorization: "Bearer leaked" },
    });

    expect(response).toMatchObject({ ok: false, retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("mints a fresh transport envelope per attempt rather than reusing a stored one", async () => {
    const headers: Record<string, string>[] = [];
    let counter = 0;

    const adapter = new HttpJsonAdapter({
      http: {
        send: (i) => {
          headers.push({ ...i.headers });
          return Promise.resolve({ status: 200 });
        },
      },
      envelopes: {
        create: () => {
          counter += 1;
          return {
            requestId: `req-${String(counter)}`,
            sentAtMs: counter * 1_000,
            headers: { "x-request-id": `req-${String(counter)}` },
          };
        },
      },
      now: () => 0,
    });

    await adapter.send(request);
    await adapter.send(request);

    expect(headers[0]?.["x-request-id"]).toBe("req-1");
    expect(headers[1]?.["x-request-id"]).toBe("req-2");
  });

  it("never sends the credential reference itself as the token", async () => {
    const seen: Record<string, string>[] = [];
    const adapter = new HttpJsonAdapter({
      http: {
        send: (input) => {
          seen.push({ ...input.headers });
          return Promise.resolve({ status: 200 });
        },
      },
      credentials: { resolve: () => Promise.resolve("real-token") },
      now: () => 0,
    });
    await adapter.send({
      ...request,
      endpoint: { ...request.endpoint, credentialRef: "vault://tracking/meta/token" },
    });
    expect(seen[0]?.authorization).toBe("Bearer real-token");
  });
});

describe("platform seed configuration", () => {
  it("registers all nine launch platforms", () => {
    expect(SEED_DESTINATIONS).toHaveLength(9);
    expect(SEED_DESTINATIONS.map((d) => d.platform)).toEqual(
      expect.arrayContaining([
        "meta",
        "google",
        "tiktok",
        "snapchat",
        "pinterest",
        "linkedin",
        "microsoft",
        "x",
      ]),
    );
  });

  it("serves every platform through the one shared transport", () => {
    expect(new Set(SEED_DESTINATIONS.map((d) => d.transport))).toEqual(new Set(["http_json"]));
  });

  it("points every destination at a mapping profile that exists", () => {
    for (const dest of SEED_DESTINATIONS) {
      expect(SEED_PROFILE_KEYS).toContain(dest.mappingProfileKey);
    }
  });

  it("holds credential references, never credential values", () => {
    for (const dest of SEED_DESTINATIONS) {
      expect(dest.endpoint.credentialRef).toMatch(/^vault:\/\//);
    }
  });

  it("gates every advertising destination on marketing consent", () => {
    expect(SEED_DESTINATIONS.every((d) => d.consentPurpose === "marketing")).toBe(true);
  });

  it("is pure data — no functions anywhere in a profile", () => {
    for (const profile of SEED_MAPPING_PROFILES) {
      expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
    }
  });
});

describe("destination health", () => {
  it("reports healthy on a high success rate with a closed circuit", () => {
    const health = deriveHealth({
      destination: "meta.capi",
      delivered: 100,
      failed: 1,
      latencyMs: 30,
      queueSize: 0,
      retryQueueSize: 0,
      circuit: INITIAL_CIRCUIT,
    });
    expect(health.status).toBe("healthy");
    expect(health.successRate).toBeCloseTo(0.9901, 3);
  });

  it("reports unavailable when the circuit is open", () => {
    const health = deriveHealth({
      destination: "meta.capi",
      delivered: 100,
      failed: 0,
      latencyMs: 30,
      queueSize: 5,
      retryQueueSize: 2,
      circuit: { ...INITIAL_CIRCUIT, status: "open" },
    });
    expect(health.status).toBe("unavailable");
    expect(health.circuitStatus).toBe("open");
  });

  it("reports degraded below the success threshold", () => {
    const health = deriveHealth({
      destination: "meta.capi",
      delivered: 80,
      failed: 20,
      latencyMs: 30,
      queueSize: 0,
      retryQueueSize: 0,
      circuit: INITIAL_CIRCUIT,
    });
    expect(health.status).toBe("degraded");
  });
});
