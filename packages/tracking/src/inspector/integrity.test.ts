import { describe, expect, it } from "vitest";

import {
  NonCanonicalizableValueError,
  canonicalize,
  computePayloadDigest,
  verifyPayloadDigest,
} from "./payload-integrity";
import { buildDestinationEntry, buildEventRecord, toDeliveryState } from "./record-delivery";
import type { HashPort } from "../ids/dedup-id";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { DestinationDefinition } from "../delivery/destination";
import type { DeliveryResult } from "../delivery/delivery-pipeline";

/** Deterministic stand-in; the production adapter is real SHA-256 at the composition root. */
const hasher: HashPort = { sha256Hex: (input) => Promise.resolve(`sha256:${input}`) };

const AT = "2026-07-19T12:00:00.000Z";

describe("canonical serialization", () => {
  it("is independent of key insertion order", () => {
    // The whole point: JSON.stringify would produce two different strings here.
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(JSON.stringify({ a: 1, b: 2 })).not.toBe(JSON.stringify({ b: 2, a: 1 }));
  });

  it("sorts keys recursively", () => {
    expect(canonicalize({ z: { b: 1, a: 2 }, a: 3 })).toBe('{"a":3,"z":{"a":2,"b":1}}');
  });

  it("preserves array order, which is semantic", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("omits undefined properties but maps undefined array slots to null", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("normalizes -0 to 0, matching a JSON round-trip", () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });

  it("throws on non-finite numbers instead of silently emitting null", () => {
    // Otherwise NaN and Infinity would digest identically.
    expect(() => canonicalize({ v: Number.NaN })).toThrow(NonCanonicalizableValueError);
    expect(() => canonicalize({ v: Number.POSITIVE_INFINITY })).toThrow(
      NonCanonicalizableValueError,
    );
  });

  it("throws on values with no stable JSON form", () => {
    expect(() => canonicalize({ fn: () => 1 })).toThrow(NonCanonicalizableValueError);
  });

  it("handles nested structures and empty containers", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({ a: [{ b: null }] })).toBe('{"a":[{"b":null}]}');
  });
});

describe("payload digest", () => {
  const payload = { event_name: "purchase", custom_data: { value: 1500, currency: "USD" } };

  it("is stable across reorderings of the same payload", async () => {
    const a = await computePayloadDigest(payload, hasher);
    const b = await computePayloadDigest(
      { custom_data: { currency: "USD", value: 1500 }, event_name: "purchase" },
      hasher,
    );
    expect(a).toBe(b);
  });

  it("changes when any value changes", async () => {
    const a = await computePayloadDigest(payload, hasher);
    const b = await computePayloadDigest(
      { ...payload, custom_data: { value: 1501, currency: "USD" } },
      hasher,
    );
    expect(a).not.toBe(b);
  });

  it("verifies a matching payload", async () => {
    const digest = await computePayloadDigest(payload, hasher);
    const result = await verifyPayloadDigest(payload, digest, hasher);
    expect(result.valid).toBe(true);
  });

  it("detects a mutated payload", async () => {
    const digest = await computePayloadDigest(payload, hasher);
    const result = await verifyPayloadDigest({ ...payload, event_name: "refund" }, digest, hasher);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("digest_mismatch");
  });

  it("treats a MISSING digest as a failure, not a pass", async () => {
    // A lost hash is exactly what a corrupted restore looks like — it must not replay unverified.
    const missing = await verifyPayloadDigest(payload, undefined, hasher);
    expect(missing.valid).toBe(false);
    if (!missing.valid) expect(missing.reason).toBe("digest_absent");

    const blank = await verifyPayloadDigest(payload, "   ", hasher);
    expect(blank.valid).toBe(false);
  });

  it("reports a non-canonicalizable payload rather than throwing", async () => {
    const result = await verifyPayloadDigest({ v: Number.NaN }, "anything", hasher);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_canonicalizable");
  });
});

describe("delivery → record wiring (M6)", () => {
  function envelope(): EnrichedEnvelope {
    return {
      eventId: "e-1",
      dedupId: "d-1",
      eventName: "purchase",
      eventVersion: 1,
      timestamp: AT,
      receivedAt: AT,
      eventTimestampMs: Date.parse(AT),
      source: "server",
      environment: "production",
      consent: { analytics: true, marketing: true, personalization: true },
      context: { identity: { customerId: "c-1", email: "sha256(x)", hashStatus: "sha256" } },
      properties: {},
      payload: { valueMinor: 1500, currency: "USD" },
      tenancy: { tenantId: "t-1" },
    } as EnrichedEnvelope;
  }

  const destination: DestinationDefinition = {
    key: "meta.capi",
    platform: "meta",
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: "meta.capi.mapping",
    endpoint: { url: "https://vendor.test", method: "POST", timeoutMs: 1_000 },
    retry: { maxAttempts: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 4 },
    enabled: true,
  };

  const delivered: DeliveryResult = {
    outcome: { status: "delivered", attempts: 2, latencyMs: 25 },
    circuit: { status: "closed", consecutiveFailures: 0, halfOpenSuccesses: 0 },
    rateLimit: { tokens: 9, lastRefillMs: 0 },
    metrics: {} as never,
  };

  const input = {
    envelope: envelope(),
    destination,
    destinationVersion: 3,
    mappingKey: "meta.capi.mapping",
    mappingVersion: 2,
    renderedPayload: { event_name: "purchase", custom_data: { value: 15 } },
    result: delivered,
    at: AT,
  };

  it("stores the business payload with a verifiable digest", async () => {
    const entry = await buildDestinationEntry(input, hasher);

    expect(entry.payloadHash).toBeDefined();
    const check = await verifyPayloadDigest(entry.renderedPayload, entry.payloadHash, hasher);
    expect(check.valid).toBe(true);
  });

  it("digests the payload AFTER stripping transport metadata", async () => {
    const entry = await buildDestinationEntry(
      { ...input, renderedPayload: { ...input.renderedPayload, authorization: "Bearer leak" } },
      hasher,
    );

    // Digesting first and stripping after would produce a hash that never verifies again.
    expect(entry.renderedPayload).not.toHaveProperty("authorization");
    expect(entry.strippedTransportKeys).toContain("authorization");

    const check = await verifyPayloadDigest(entry.renderedPayload, entry.payloadHash, hasher);
    expect(check.valid).toBe(true);
  });

  it("records intermediate retries, not just the final attempt", async () => {
    const entry = await buildDestinationEntry(input, hasher);

    expect(entry.attempts).toHaveLength(2);
    expect(entry.attempts[0]?.outcome).toBe("retryable_failure");
    expect(entry.attempts[1]).toMatchObject({ attempt: 2, outcome: "delivered", latencyMs: 25 });
  });

  it("records a dead-letter with its error", async () => {
    const entry = await buildDestinationEntry(
      {
        ...input,
        result: { ...delivered, outcome: { status: "dead_lettered", attempts: 3, error: "503" } },
      },
      hasher,
    );

    expect(entry.status).toBe("dead_lettered");
    expect(entry.attempts.at(-1)).toMatchObject({ outcome: "permanent_failure", error: "503" });
  });

  it("records a blocked delivery with the breached gate", async () => {
    const entry = await buildDestinationEntry(
      {
        ...input,
        result: {
          ...delivered,
          outcome: {
            status: "blocked",
            failure: { gate: "pii_hashing", detail: "hashStatus=raw" },
          },
        },
      },
      hasher,
    );

    expect(entry.status).toBe("blocked");
    expect(entry.attempts[0]?.error).toContain("pii_hashing");
  });

  it("maps every delivery outcome to a stored state", () => {
    expect(toDeliveryState({ status: "delivered", attempts: 1, latencyMs: 1 })).toBe("delivered");
    expect(toDeliveryState({ status: "skipped_duplicate" })).toBe("delivered");
    expect(toDeliveryState({ status: "rate_limited", retryAfterMs: 10 })).toBe("rate_limited");
    expect(toDeliveryState({ status: "circuit_open" })).toBe("retrying");
  });

  it("assembles a complete record with all required forensic fields", async () => {
    const entry = await buildDestinationEntry(input, hasher);
    const record = buildEventRecord({
      envelope: envelope(),
      stageHistory: [{ stage: "normalize", status: "completed", at: AT }],
      destinationEntries: [entry],
      ruleSet: { id: "routing", version: 4 },
      identityConfidence: 0.9,
      at: AT,
    });

    expect(record).toMatchObject({
      eventId: "e-1",
      dedupId: "d-1",
      tenantId: "t-1",
      hashStatus: "sha256",
      state: "delivered",
    });
    expect(record.consentSnapshot.marketing).toBe(true);
    expect(record.identitySnapshot.customerId).toBe("c-1");
    expect(record.versions.ruleSetVersion).toBe(4);
    expect(record.stageHistory).toHaveLength(1);
    expect(record.destinationHistory[0]?.payloadHash).toBeDefined();
  });

  it("records router exclusions so 'why did this never leave?' stays answerable", async () => {
    const record = buildEventRecord({
      envelope: envelope(),
      stageHistory: [],
      destinationEntries: [],
      exclusions: [{ destination: "pinterest.capi", reason: "consent_denied" }],
      at: AT,
    });

    expect(record.state).toBe("blocked");
    expect(record.destinationHistory[0]).toMatchObject({
      destination: "pinterest.capi",
      status: "excluded",
      exclusionReason: "consent_denied",
    });
  });

  it("snapshots consent, so a later consent change never rewrites the record", () => {
    const record = buildEventRecord({
      envelope: envelope(),
      stageHistory: [],
      destinationEntries: [],
      at: AT,
    });

    // The snapshot is a copy taken at processing time — there is no live lookup to drift.
    expect(record.consentSnapshot).toEqual(envelope().consent);
  });
});
