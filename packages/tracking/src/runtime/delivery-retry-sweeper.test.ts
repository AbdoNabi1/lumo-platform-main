/**
 * Tracking P1-D2: parking a transient failure, and the sweeper that retries it inside the vendor window.
 * Everything runs against in-memory ports (a real Postgres claim is covered by the app-level
 * integration test); the vendor is a scripted HTTP transport.
 */

import { createHash } from "node:crypto";

import { RetryPolicy } from "@platform/messaging";
import { beforeEach, describe, expect, it } from "vitest";

import { HttpJsonAdapter, type HttpTransportPort } from "../delivery/adapters";
import type { DeliveryDeps } from "../delivery/delivery-pipeline";
import type { DestinationDefinition, DestinationRegistryPort } from "../delivery/destination";
import type { MappingProfile } from "../delivery/mapping";
import { STANDARD_RETRY } from "../delivery/platform-profiles";
import type { RoutingDecision } from "../delivery/router";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { HashPort } from "../ids/dedup-id";
import type {
  DestinationHistoryEntry,
  EventRecord,
  StageHistoryEntry,
} from "../inspector/event-record";
import type {
  DeliveryRetryEntry,
  DeliveryRetryKey,
  DeliveryRetryQueuePort,
} from "./delivery-retry";
import { sweepDeliveryRetries, type RetryTenantRuntime } from "./delivery-retry-sweeper";
import {
  InMemoryDestinationState,
  receiveAndDeliver,
  type RecordingRuntimeDeps,
} from "./delivery-runtime";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EVENT_TIME_MS = 1764000000123;
const T0 = EVENT_TIME_MS + 1_000;

const hasher: HashPort = {
  sha256Hex: async (s) => createHash("sha256").update(s, "utf8").digest("hex"),
};

function envelope(eventId = "01919d1e-0000-7000-8000-000000000001"): EnrichedEnvelope {
  return {
    eventId,
    eventName: "form_submitted",
    eventVersion: 1,
    dedupId: `lead_${eventId}`,
    timestamp: new Date(EVENT_TIME_MS).toISOString(),
    receivedAt: new Date(T0).toISOString(),
    eventTimestampMs: EVENT_TIME_MS,
    source: "server",
    environment: "production",
    consent: {
      analytics: true,
      marketing: true,
      personalization: true,
      grants: { ad_storage: true, ad_user_data: true, ad_personalization: true },
    },
    context: {
      page: { url: "https://clinic.example/offers" },
      identity: { email: "h-em", phone: "h-ph", hashStatus: "sha256" },
      technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
      attribution: {
        meta: { fbp: "fb.1.1764000000000.123456789" },
        browserIds: { gaClientId: "111111111.1764000000" },
      },
    },
    properties: {},
    tenancy: { tenantId: "t-1" },
  } as EnrichedEnvelope;
}

function destination(
  key: string,
  platform: string,
  builderKey: DestinationDefinition["builderKey"],
  target: string,
  url: string,
): DestinationDefinition {
  return {
    key,
    platform,
    transport: "http_json",
    channel: "server",
    consentPurpose: "marketing",
    mappingProfileKey: `${key}.stub`,
    endpoint: {
      url,
      method: "POST",
      credentialRef: `conn://t-1/${platform}`,
      auth: { kind: "query", param: "access_token" },
      timeoutMs: 5_000,
    },
    retry: STANDARD_RETRY,
    enabled: true,
    builderKey,
    vendorTarget: { id: target },
  };
}

const META = destination(
  "meta.capi.shop",
  "meta",
  "meta.capi.v27",
  "123456789012345",
  "https://graph.facebook.com/v27.0/123456789012345/events",
);
const GA4 = destination(
  "ga4.mp.shop",
  "ga4",
  "ga4.mp",
  "G-ABCD1234",
  "https://www.google-analytics.com/mp/collect?measurement_id=G-ABCD1234",
);

/** An in-memory queue with the real contract: one row per key, leases, settle states. */
class FakeQueue implements DeliveryRetryQueuePort {
  readonly rows = new Map<
    string,
    { -readonly [K in keyof DeliveryRetryEntry]: DeliveryRetryEntry[K] } & {
      status: "pending" | "delivered" | "dead_lettered";
      reason: string | null;
    }
  >();
  failSchedule = false;

  private static idOf(key: DeliveryRetryKey): string {
    return `${key.tenantId}|${key.eventId}|${key.destination}`;
  }

  schedule(entry: DeliveryRetryEntry): Promise<void> {
    if (this.failSchedule) return Promise.reject(new Error("queue down"));
    const id = FakeQueue.idOf(entry);
    if (!this.rows.has(id)) this.rows.set(id, { ...entry, status: "pending", reason: null });
    return Promise.resolve();
  }

  claimDue(input: { limit: number; now: Date; leaseMs: number }): Promise<DeliveryRetryEntry[]> {
    const due = [...this.rows.values()]
      .filter((row) => row.status === "pending" && row.nextRetryAt.getTime() <= input.now.getTime())
      .sort((a, b) => a.nextRetryAt.getTime() - b.nextRetryAt.getTime())
      .slice(0, input.limit);
    const out = due.map((row) => ({ ...row }));
    for (const row of due) row.nextRetryAt = new Date(input.now.getTime() + input.leaseMs);
    return Promise.resolve(out);
  }

  markDelivered(key: DeliveryRetryKey): Promise<void> {
    const row = this.rows.get(FakeQueue.idOf(key));
    if (row !== undefined) row.status = "delivered";
    return Promise.resolve();
  }

  reschedule(
    key: DeliveryRetryKey,
    change: { attempts: number; nextRetryAt: Date; lastError: string | null },
  ): Promise<void> {
    const row = this.rows.get(FakeQueue.idOf(key));
    if (row !== undefined) Object.assign(row, change);
    return Promise.resolve();
  }

  markDeadLettered(key: DeliveryRetryKey, reason: string): Promise<void> {
    const row = this.rows.get(FakeQueue.idOf(key));
    if (row !== undefined) {
      row.status = "dead_lettered";
      row.reason = reason;
    }
    return Promise.resolve();
  }

  only(): DeliveryRetryEntry & { status: string; reason: string | null } {
    expect(this.rows.size).toBe(1);
    return [...this.rows.values()][0]!;
  }
}

interface Reply {
  readonly status: number;
  readonly error?: string;
}

function world(destinations: readonly DestinationDefinition[]) {
  let nowMs = T0;
  const clock = { now: (): Date => new Date(nowMs) };
  const calls: { url: string; body: { data?: { event_id?: string }[] } }[] = [];
  const replies: Reply[] = [];
  const deadLetters: { messageId: string; error: string; attempts: number }[] = [];
  const processedKeys: string[] = [];
  const store = new Map<string, EventRecord>();
  const histories: { stages?: readonly StageHistoryEntry[]; state: string }[] = [];

  const http: HttpTransportPort = {
    send: (input) => {
      calls.push({ url: input.url, body: JSON.parse(input.body ?? "{}") });
      return Promise.resolve(replies.shift() ?? { status: 200 });
    },
  };
  const adapter = new HttpJsonAdapter({
    http,
    credentials: { resolve: () => Promise.resolve("s3cret-token") },
    now: () => nowMs,
  });
  const delivery: DeliveryDeps = {
    adapters: { resolve: () => adapter },
    mappings: {
      resolve: (): MappingProfile => ({
        key: "stub",
        version: 1,
        destination: "stub",
        fields: [{ target: "event_name", source: "event.name" }],
      }),
      resolveVersion: (): null => null,
    },
    retryPolicy: new RetryPolicy({
      maxAttempts: 2,
      baseDelayMs: 1,
      factor: 2,
      maxDelayMs: 4,
      jitter: () => 0,
    }),
    // Like the real store: a key seen once is a duplicate forever.
    processed: {
      recordIfNew: (key) => {
        if (processedKeys.includes(key)) return Promise.resolve(false);
        processedKeys.push(key);
        return Promise.resolve(true);
      },
    },
    deadLetters: {
      add: (entry) => {
        deadLetters.push(entry);
        return Promise.resolve();
      },
    },
    sleep: () => Promise.resolve(),
    now: clock.now,
  };
  const destinationState = new InMemoryDestinationState();
  const records = {
    append: (record: EventRecord): Promise<void> => {
      store.set(`${record.tenantId}|${record.eventId}`, record);
      return Promise.resolve();
    },
    appendHistory: (input: {
      eventId: string;
      tenantId: string;
      stages?: readonly StageHistoryEntry[];
      destinations?: readonly DestinationHistoryEntry[];
      state: EventRecord["state"];
    }): Promise<void> => {
      const key = `${input.tenantId}|${input.eventId}`;
      const record = store.get(key)!;
      const merged = new Map(record.destinationHistory.map((e) => [e.destination, e]));
      for (const entry of input.destinations ?? []) merged.set(entry.destination, entry);
      store.set(key, {
        ...record,
        stageHistory: [...record.stageHistory, ...(input.stages ?? [])],
        destinationHistory: [...merged.values()],
        state: input.state,
      });
      histories.push({
        ...(input.stages === undefined ? {} : { stages: input.stages }),
        state: input.state,
      });
      return Promise.resolve();
    },
    get: (eventId: string, tenantId: string): Promise<EventRecord | null> =>
      Promise.resolve(store.get(`${tenantId}|${eventId}`) ?? null),
  };
  const queue = new FakeQueue();

  const registry: DestinationRegistryPort = {
    resolve: (key) => destinations.find((d) => d.key === key) ?? null,
    resolveVersion: () => null,
    listActive: () => destinations,
  };
  const ingestDeps: RecordingRuntimeDeps = {
    delivery,
    records,
    hasher,
    versions: { destinationVersion: () => 1, mappingVersion: () => 1, ruleSet: () => null },
    destinationState,
    clock,
    retryQueue: queue,
  };
  const routing: RoutingDecision = {
    routed: destinations.map((d) => ({ destination: d })),
    excluded: [],
    evaluation: {} as RoutingDecision["evaluation"],
    degraded: false,
  };
  const runtime: RetryTenantRuntime = {
    delivery,
    destinations: registry,
    destinationState,
    records,
  };
  const sweep = (overrides: Partial<Parameters<typeof sweepDeliveryRetries>[0]> = {}) =>
    sweepDeliveryRetries({
      queue,
      runtimeFor: () => Promise.resolve(runtime),
      clock,
      batchSize: 10,
      leaseMs: 10 * MINUTE,
      budgetMs: 5 * MINUTE,
      ...overrides,
    });
  return {
    calls,
    replies,
    deadLetters,
    store,
    histories,
    queue,
    ingestDeps,
    routing,
    sweep,
    setNow: (ms: number): void => {
      nowMs = ms;
    },
    runtime,
    ingest: (env = envelope()) => receiveAndDeliver(ingestDeps, { envelope: env, routing }),
  };
}

const FAIL_503: Reply = { status: 503 };

describe("parking a transient failure (P1-D2)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("an exhausted 503 is parked, not dead-lettered, with the vendor window and the first slot", async () => {
    const w = world([GA4]);
    w.replies.push(FAIL_503, FAIL_503);
    const out = await w.ingest();

    expect(out.results[0]?.result.outcome).toMatchObject({
      status: "dead_lettered",
      retryable: true,
    });
    expect(w.deadLetters).toEqual([]);
    const row = w.queue.only();
    expect(row).toMatchObject({
      tenantId: "t-1",
      eventId: "01919d1e-0000-7000-8000-000000000001",
      destination: "ga4.mp.shop",
      platform: "ga4",
      attempts: 1,
      status: "pending",
    });
    expect(row.eventTimestamp.getTime()).toBe(EVENT_TIME_MS);
    expect(row.windowExpiresAt.getTime()).toBe(EVENT_TIME_MS + 72 * HOUR);
    expect(row.nextRetryAt.getTime()).toBe(T0 + MINUTE);
    // The record says "retrying", not "dead_lettered": the event is not lost.
    expect(out.record.destinationHistory[0]?.status).toBe("retrying");
    expect(out.record.state).toBe("processing");
    expect(out.record.destinationHistory[0]?.attempts.at(-1)?.outcome).toBe("retryable_failure");
  });

  it("Meta's window is 7 days minus 1 hour", async () => {
    const w = world([META]);
    w.replies.push(FAIL_503, FAIL_503);
    await w.ingest();
    expect(w.queue.only().windowExpiresAt.getTime()).toBe(EVENT_TIME_MS + 7 * DAY - HOUR);
  });

  it("a permanent refusal is dead-lettered at once and never parked", async () => {
    const w = world([META]);
    w.replies.push({ status: 400 });
    const out = await w.ingest();
    expect(w.queue.rows.size).toBe(0);
    expect(w.deadLetters).toHaveLength(1);
    expect(out.record.destinationHistory[0]?.status).toBe("dead_lettered");
  });

  it("without a retry queue an exhausted failure is dead-lettered exactly as before", async () => {
    const w = world([META]);
    w.replies.push(FAIL_503, FAIL_503);
    const { retryQueue: _unused, ...withoutQueue } = w.ingestDeps;
    void _unused;
    const out = await receiveAndDeliver(withoutQueue, { envelope: envelope(), routing: w.routing });
    expect(w.deadLetters).toHaveLength(1);
    expect(out.record.destinationHistory[0]?.status).toBe("dead_lettered");
  });

  it("when the queue itself is down the event is dead-lettered, not lost", async () => {
    const w = world([META]);
    w.replies.push(FAIL_503, FAIL_503);
    w.queue.failSchedule = true;
    const out = await w.ingest();
    expect(w.deadLetters).toHaveLength(1);
    expect(out.record.destinationHistory[0]?.status).toBe("dead_lettered");
  });

  it("the jitter source spreads the first slot over ±20%, still inside the window", async () => {
    const early = world([GA4]);
    early.replies.push(FAIL_503, FAIL_503);
    await receiveAndDeliver(
      { ...early.ingestDeps, random: () => 0 },
      { envelope: envelope(), routing: early.routing },
    );
    expect(early.queue.only().nextRetryAt.getTime()).toBe(T0 + Math.round(MINUTE * 0.8));

    const late = world([GA4]);
    late.replies.push(FAIL_503, FAIL_503);
    await receiveAndDeliver(
      { ...late.ingestDeps, random: () => 0.999999 },
      { envelope: envelope(), routing: late.routing },
    );
    expect(late.queue.only().nextRetryAt.getTime()).toBeGreaterThan(T0 + Math.round(MINUTE * 1.19));
  });
});

describe("the sweeper (P1-D2)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  async function parked(destinations: readonly DestinationDefinition[] = [META]) {
    const w = world(destinations);
    w.replies.push(FAIL_503, FAIL_503);
    await w.ingest();
    expect(w.queue.rows.size).toBe(destinations.length);
    w.calls.length = 0;
    return w;
  }

  it("does nothing before the first slot is due", async () => {
    const w = await parked();
    const report = await w.sweep();
    expect(report).toEqual({
      claimed: 0,
      delivered: 0,
      rescheduled: 0,
      deadLettered: 0,
      errored: 0,
    });
    expect(w.calls).toEqual([]);
  });

  it("re-delivers with the SAME event id and settles delivered, even though the processed marker exists", async () => {
    const w = await parked();
    const first = JSON.stringify(
      w.store.values().next().value?.destinationHistory[0]?.renderedPayload,
    );
    w.setNow(T0 + 2 * MINUTE);
    const report = await w.sweep();

    expect(report).toMatchObject({ claimed: 1, delivered: 1, rescheduled: 0, deadLettered: 0 });
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]?.body.data?.[0]?.event_id).toBe("lead_01919d1e-0000-7000-8000-000000000001");
    // Byte-identical to the stored payload — nothing was re-mapped.
    expect(JSON.stringify(w.calls[0]?.body)).toBe(first);
    expect(w.queue.only()).toMatchObject({ status: "delivered" });

    const record = w.store.values().next().value as EventRecord;
    expect(record.destinationHistory[0]?.status).toBe("delivered");
    expect(record.state).toBe("delivered");
    // attempts are numbered on from the in-process ones
    expect(record.destinationHistory[0]?.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
  });

  it("a vendor that fails again is rescheduled on the backoff, counting the round", async () => {
    const w = await parked();
    w.setNow(T0 + 2 * MINUTE);
    w.replies.push(FAIL_503, FAIL_503);
    const report = await w.sweep();

    expect(report).toMatchObject({ claimed: 1, rescheduled: 1, delivered: 0 });
    const row = w.queue.only();
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
    expect(row.nextRetryAt.getTime()).toBe(T0 + 2 * MINUTE + 5 * MINUTE);
    expect(row.lastError).not.toContain("s3cret");
    expect(w.deadLetters).toEqual([]);
  });

  it("is capped by the window: a final try near the end, then dead-lettered window_closed", async () => {
    const w = await parked([GA4]);
    const expires = EVENT_TIME_MS + 72 * HOUR;

    // Walk the schedule with a vendor that never recovers.
    let guard = 0;
    for (;;) {
      const row = w.queue.only();
      if (row.status !== "pending") break;
      expect(row.nextRetryAt.getTime()).toBeLessThanOrEqual(expires - 2 * MINUTE);
      w.setNow(row.nextRetryAt.getTime());
      w.replies.push(FAIL_503, FAIL_503);
      await w.sweep();
      guard += 1;
      expect(guard).toBeLessThan(40);
    }

    const row = w.queue.only();
    expect(row.status).toBe("dead_lettered");
    expect(row.reason).toMatch(/^window_closed: /);
    expect(w.deadLetters).toHaveLength(1);
    expect(w.deadLetters[0]?.messageId).toBe("01919d1e-0000-7000-8000-000000000001");
    expect(guard).toBeGreaterThanOrEqual(5);
    const record = w.store.values().next().value as EventRecord;
    expect(record.destinationHistory[0]?.status).toBe("dead_lettered");
  });

  it("a delivery found past its window is dead-lettered without a send", async () => {
    const w = await parked([GA4]);
    w.setNow(EVENT_TIME_MS + 73 * HOUR);
    const report = await w.sweep();
    expect(report).toMatchObject({ claimed: 1, deadLettered: 1 });
    expect(w.calls).toEqual([]);
    expect(w.queue.only()).toMatchObject({ status: "dead_lettered", reason: "window_expired" });
    expect(w.deadLetters).toHaveLength(1);
  });

  it("a permanent refusal on retry is dead-lettered with the reason", async () => {
    const w = await parked();
    w.setNow(T0 + 2 * MINUTE);
    w.replies.push({ status: 400 });
    const report = await w.sweep();
    expect(report).toMatchObject({ claimed: 1, deadLettered: 1 });
    expect(w.queue.only().reason).toMatch(/^permanent_refusal: /);
    expect(w.calls).toHaveLength(1); // one send, no retry of a 400
    expect(w.deadLetters).toHaveLength(1);
  });

  it("a destination removed since is dead-lettered as destination_unavailable", async () => {
    const w = await parked();
    w.setNow(T0 + 2 * MINUTE);
    const report = await w.sweep({
      runtimeFor: () =>
        Promise.resolve({
          ...w.runtime,
          destinations: { resolve: () => null, resolveVersion: () => null, listActive: () => [] },
        }),
    });
    expect(report).toMatchObject({ deadLettered: 1 });
    expect(w.queue.only().reason).toBe("destination_unavailable");
    expect(w.calls).toEqual([]);
  });

  it("an open circuit defers without counting a failed round or calling the vendor", async () => {
    const w = await parked();
    w.setNow(T0 + 2 * MINUTE);
    // Trip the destination's breaker: three fresh failures.
    w.runtime.destinationState.set(META.key, {
      ...w.runtime.destinationState.get(META, T0),
      circuit: {
        state: "open",
        failures: 99,
        openedAtMs: T0 + 2 * MINUTE,
        halfOpenSuccesses: 0,
      } as never,
    });
    const report = await w.sweep();
    expect(report).toMatchObject({ claimed: 1, rescheduled: 1 });
    expect(w.calls).toEqual([]);
    const row = w.queue.only();
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt.getTime()).toBe(T0 + 2 * MINUTE + MINUTE);
  });

  it("one entry that throws does not stop the pass", async () => {
    const w = world([META, GA4]);
    w.replies.push(FAIL_503, FAIL_503, FAIL_503, FAIL_503);
    await w.ingest();
    expect(w.queue.rows.size).toBe(2);
    w.setNow(T0 + 2 * MINUTE);
    let calls = 0;
    const report = await w.sweep({
      runtimeFor: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("registry down"))
          : Promise.resolve(w.runtime);
      },
    });
    expect(report).toMatchObject({ claimed: 2, errored: 1, delivered: 1 });
  });
});
