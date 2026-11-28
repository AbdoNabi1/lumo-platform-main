import { createHash } from "node:crypto";

import type { LiveConnection } from "@platform/ad-platforms";
import type { IntegrationEvent } from "@platform/domain-events";
import { RetryPolicy } from "@platform/messaging";
import {
  DENY_ALL_CONSENT,
  HttpJsonAdapter,
  InMemoryDestinationState,
  InMemoryTrackingProfileStore,
  InMemoryTrackingSettingsStore,
  TrackingProfileService,
  TrackingSettingsService,
  ingestTrackingEvent,
  type ConsentSnapshot,
  type EventRecordWriterPort,
  type HttpTransportPort,
  type IngestOutcome,
  type IngestRuntimeDeps,
  type TrackingEnvelope,
} from "@platform/tracking";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdPlatformDeliverySync } from "./ad-platform-destinations";
import { ConnectionCredentialResolver } from "./connection-credential-resolver";
import { fakeTrackingDb } from "./testing/fake-tracking-db";
import { TrackingIngestHandler, type TrackingCapturedPayload } from "./tracking-ingest";
import {
  PrismaTrackingRegistryStore,
  loadTrackingRegistry,
  mappingRegistryOf,
  ruleSetRegistryOf,
} from "./tracking-registry";
import { TrackingRegistryHandle, TrackingRegistryWatcher } from "./tracking-registry-handle";
import { DEFAULT_RULE_SET_KEY } from "./tracking-registry-seed";

/**
 * Tracking P2-D1 (consent stamped from the store's policy) and P2-D2 (a store with nothing connected) through the REAL
 * ingest and recording runtime: Meta destination synced from a connection, the real vendor builder, the real profile
 * service over an in-memory profile store, the real registry store over a Prisma-shaped fake.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const nodeSha = { sha256Hex: (value: string) => Promise.resolve(sha(value)) };

const SECRET = "se+cr/et=:|proof1234";
const T0 = new Date("2026-11-28T10:00:00.000Z");
const TENANT = "t-1";

const META: LiveConnection = {
  platform: "meta",
  publicConfig: { platform: "meta", pixelId: "123456789012345" },
  secret: SECRET,
  testEventCode: null,
};

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

interface RecordedEvent {
  readonly tenantId: string;
  readonly consentSnapshot: ConsentSnapshot;
}

async function harness(options: { connections?: readonly LiveConnection[] } = {}) {
  const db = fakeTrackingDb();
  let counter = 0;
  const registryStore = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => `id-${String((counter += 1))}`,
  });
  const sync = new AdPlatformDeliverySync({
    store: registryStore,
    connections: { listLive: () => Promise.resolve(options.connections ?? []) },
    siteTypeOf: () => Promise.resolve("lead_site"),
    clock: { now: () => T0 },
  });
  if ((options.connections ?? []).length > 0) await sync.sync(TENANT);
  const handle = new TrackingRegistryHandle(
    await loadTrackingRegistry(registryStore, TENANT),
    await registryStore.signal(TENANT),
  );

  const calls: Call[] = [];
  const http: HttpTransportPort = {
    send: (input) => {
      calls.push({
        url: input.url,
        body: input.body === undefined ? {} : (JSON.parse(input.body) as Record<string, unknown>),
      });
      return Promise.resolve({ status: 200 });
    },
  };
  const adapter = new HttpJsonAdapter({
    http,
    credentials: new ConnectionCredentialResolver({
      connections: { openSecret: () => Promise.resolve(SECRET) },
      fallback: { resolve: () => Promise.resolve(null) },
    }),
    now: () => T0.getTime(),
  });
  const appended: RecordedEvent[] = [];
  const writer: EventRecordWriterPort = {
    append: (record) => {
      appended.push(record as unknown as RecordedEvent);
      return Promise.resolve();
    },
    appendHistory: () => Promise.resolve(),
  };

  const profiles = new InMemoryTrackingProfileStore();
  const profileService = new TrackingProfileService({
    store: profiles,
    hasher: nodeSha,
    clock: { now: () => T0 },
  });
  const settingsStore = new InMemoryTrackingSettingsStore();
  const settings = new TrackingSettingsService({
    store: settingsStore,
    clock: { now: () => T0 },
    cacheTtlMs: 0,
  });

  /** Everything `ingest()` of the production wiring hands out for one event, bound to the pinned snapshot. */
  const depsFor = (withPolicy: boolean): IngestRuntimeDeps => {
    const snapshot = handle.current();
    return {
      recording: {
        delivery: {
          adapters: { resolve: () => adapter },
          mappings: mappingRegistryOf(snapshot),
          retryPolicy: new RetryPolicy({
            maxAttempts: 1,
            baseDelayMs: 1,
            factor: 2,
            maxDelayMs: 4,
          }),
          processed: { recordIfNew: () => Promise.resolve(true) },
          deadLetters: { add: () => Promise.resolve() },
          sleep: () => Promise.resolve(),
          now: () => T0,
        },
        records: writer,
        hasher: nodeSha,
        versions: snapshot,
        destinationState: new InMemoryDestinationState(),
        clock: { now: () => T0 },
      },
      destinations: snapshot,
      ruleSets: ruleSetRegistryOf(snapshot),
      ruleSetKey: DEFAULT_RULE_SET_KEY,
      hasher: nodeSha,
      clock: { now: () => T0 },
      profiles: profileService,
      ...(withPolicy ? { consentPolicy: settings } : {}),
    };
  };

  let n = 0;
  const envelope = (over: Partial<TrackingEnvelope> = {}): TrackingEnvelope => {
    n += 1;
    return {
      eventId: `01919d1e-0000-7000-8000-${String(n).padStart(12, "0")}`,
      eventName: "form_submitted",
      eventVersion: 1,
      dedupId: `mb_event_${String(n)}`,
      timestamp: T0.toISOString(),
      source: "server",
      environment: "production",
      consent: DENY_ALL_CONSENT,
      properties: {},
      tenancy: { tenantId: TENANT },
      context: {
        session: { visitorId: "v-1", sessionId: "s-1" },
        page: { url: "https://clinic.example/offers" },
        technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
        identity: { phone: "+201****5678", hashStatus: "raw" },
      },
      ...over,
    } as unknown as TrackingEnvelope;
  };

  const ingest = (env: TrackingEnvelope, withPolicy = true): Promise<IngestOutcome> =>
    ingestTrackingEvent(depsFor(withPolicy), { envelope: env });

  return {
    ingest,
    envelope,
    depsFor,
    calls,
    appended,
    profiles,
    settings,
    settingsStore,
    sync,
    db,
    handle,
    watcher: new TrackingRegistryWatcher({
      handle,
      store: registryStore,
      tenantId: TENANT,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      intervalMs: 30_000,
    }),
  };
}

const metaCalls = (calls: readonly Call[]): Call[] =>
  calls.filter((call) => call.url.includes("graph.facebook.com"));

describe("consent is stamped from the store's policy (P2-D1)", () => {
  it("notice_only (no settings row): an event the browser sent with NO consent is forwarded, under the exact notice-only snapshot", async () => {
    const h = await harness({ connections: [META] });
    const outcome = await h.ingest(h.envelope({ consent: DENY_ALL_CONSENT }));

    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(1);
    expect(h.appended).toHaveLength(1);
    expect(h.appended[0]?.consentSnapshot).toEqual({
      analytics: true,
      marketing: true,
      personalization: false,
      grants: {
        analytics_storage: true,
        ad_storage: true,
        ad_user_data: true,
        ad_personalization: false,
      },
      framework: "notice_only",
      capturedAt: T0.toISOString(),
    });
  });

  it("notice_only overwrites whatever consent the envelope carried — a body that claims personalization gets none", async () => {
    const h = await harness({ connections: [META] });
    await h.ingest(
      h.envelope({
        consent: { analytics: false, marketing: false, personalization: true, recordRef: "x" },
      }),
    );
    expect(h.appended[0]?.consentSnapshot).toMatchObject({
      marketing: true,
      personalization: false,
      framework: "notice_only",
    });
    expect(h.appended[0]?.consentSnapshot.recordRef).toBeUndefined();
  });

  it("opt_in: a denied event is recorded but forwarded nowhere; the stamp does not grant anything", async () => {
    const h = await harness({ connections: [META] });
    await h.settings.update(TENANT, {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    const outcome = await h.ingest(h.envelope({ consent: DENY_ALL_CONSENT }));

    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(0);
    expect(h.appended[0]?.consentSnapshot).toEqual(DENY_ALL_CONSENT);
    if (outcome.status === "accepted") {
      expect(outcome.routing.excluded.map((e) => e.reason.code)).toContain("consent_denied");
    }
  });

  it("opt_in: an envelope that already carries explicit grants is forwarded exactly as before", async () => {
    const h = await harness({ connections: [META] });
    await h.settings.update(TENANT, {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    const granted: ConsentSnapshot = {
      analytics: true,
      marketing: true,
      personalization: false,
      grants: { ad_storage: true, ad_user_data: true, analytics_storage: true },
      framework: "cmp",
    };
    await h.ingest(h.envelope({ consent: granted }));

    expect(metaCalls(h.calls)).toHaveLength(1);
    expect(h.appended[0]?.consentSnapshot).toEqual(granted);
  });

  it("an unreadable settings store falls back to notice_only: the event is forwarded, nothing throws", async () => {
    const h = await harness({ connections: [META] });
    h.settingsStore.failWith = new Error("db is down");
    const outcome = await h.ingest(h.envelope({ consent: DENY_ALL_CONSENT }));

    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(1);
    expect(h.appended[0]?.consentSnapshot.framework).toBe("notice_only");
  });

  it("a consent-policy port that throws is the same fail-open: notice_only", async () => {
    const h = await harness({ connections: [META] });
    const deps: IngestRuntimeDeps = {
      ...h.depsFor(false),
      consentPolicy: { consentPolicyFor: () => Promise.reject(new Error("port is down")) },
    };
    const outcome = await ingestTrackingEvent(deps, { envelope: h.envelope() });
    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(1);
  });

  it("without the policy dependency consent is left as it arrived (the old behaviour; fail-closed)", async () => {
    const h = await harness({ connections: [META] });
    const outcome = await h.ingest(h.envelope({ consent: DENY_ALL_CONSENT }), false);
    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(0);
    expect(h.appended[0]?.consentSnapshot).toEqual(DENY_ALL_CONSENT);
  });

  it("two stores keep their own policy: opt_in for one never changes the other", async () => {
    const h = await harness({ connections: [META] });
    await h.settings.update("t-other", {
      consentPolicy: "opt_in",
      cookieNoticeEnabled: true,
      expectedVersion: 0,
    });
    const outcome = await h.ingest(h.envelope({ consent: DENY_ALL_CONSENT }));
    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(1);
  });
});

describe("a store with nothing connected loads an empty registry and records nothing (P2-D2)", () => {
  it("loading a tenant with zero registry rows does not throw", async () => {
    const h = await harness();
    expect(h.handle.current().listActive()).toEqual([]);
    expect(h.handle.current().resolveRuleSet(DEFAULT_RULE_SET_KEY)).toBeNull();
  });

  it("ingest answers 'unrouted': no record, no delivery, no throw — and the visitor profile is still updated", async () => {
    const h = await harness();
    const outcome = await h.ingest(h.envelope());

    expect(outcome).toEqual({ status: "unrouted", reason: "no_destinations" });
    expect(h.appended).toEqual([]);
    expect(h.calls).toEqual([]);
    const profiles = h.profiles.all(TENANT);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ visitorId: "v-1", lastIp: "203.0.113.7" });
  });

  it("a second event of the same visitor keeps merging into the one profile", async () => {
    const h = await harness();
    await h.ingest(h.envelope());
    await h.ingest(h.envelope({ context: { session: { visitorId: "v-1" } } } as never));
    expect(h.profiles.all(TENANT)).toHaveLength(1);
    expect(h.appended).toEqual([]);
  });

  it("through the consumer: acked, counted as unrouted, NOT refused, NOT dead-lettered, no retry throw", async () => {
    const h = await harness();
    const deadLetters = { add: vi.fn(() => Promise.resolve()) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const consumer = new TrackingIngestHandler({
      ingest: () => Promise.resolve(h.depsFor(true)),
      deadLetters,
      logger: logger as never,
      clock: { now: () => T0 },
    });
    const event = {
      messageId: "m-1",
      type: "tracking.event.captured",
      eventVersion: 1,
      tenantId: TENANT,
      payload: { envelope: h.envelope() },
    } as unknown as IntegrationEvent<TrackingCapturedPayload>;

    await expect(consumer.handle(event)).resolves.toBeUndefined();

    expect(consumer.counters()).toMatchObject({
      received: 1,
      accepted: 0,
      refused: 0,
      unrouted: 1,
      deadLettered: 0,
    });
    expect(deadLetters.add).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(h.appended).toEqual([]);
  });

  it("the first connection saved after start is picked up by the registry watcher; the next event is delivered", async () => {
    const h = await harness();
    expect((await h.ingest(h.envelope())).status).toBe("unrouted");
    expect(await h.watcher.refreshNow()).toMatchObject({ status: "unchanged" });

    // the merchant connects Meta: the connection save writes destination, mapping and rule set
    const connected = new AdPlatformDeliverySync({
      store: new PrismaTrackingRegistryStore(h.db.prisma as never, {
        generate: () => crypto.randomUUID(),
      }),
      connections: { listLive: () => Promise.resolve([META]) },
      siteTypeOf: () => Promise.resolve("lead_site"),
      clock: { now: () => T0 },
    });
    await connected.sync(TENANT);

    expect(await h.watcher.refreshNow()).toMatchObject({
      status: "swapped",
      activeDestinations: 1,
    });
    const outcome = await h.ingest(h.envelope());
    expect(outcome.status).toBe("accepted");
    expect(metaCalls(h.calls)).toHaveLength(1);
    expect(h.appended).toHaveLength(1);
  });

  it("destinations without the configured rule set is also 'unrouted' (never a retry or a dead letter), with its own reason", async () => {
    const h = await harness({ connections: [META] });
    // drop the rule set rows: a wrong TRACKING_RULE_SET_KEY looks exactly like this to the runtime
    const keep = h.db.entries.filter((entry) => entry.kind !== "rule_set");
    h.db.entries.splice(0, h.db.entries.length, ...keep);
    const registryStore = new PrismaTrackingRegistryStore(h.db.prisma as never, {
      generate: () => crypto.randomUUID(),
    });
    h.handle.swap(
      await loadTrackingRegistry(registryStore, TENANT),
      await registryStore.signal(TENANT),
    );

    expect(await h.ingest(h.envelope())).toEqual({ status: "unrouted", reason: "no_rule_set" });
    expect(h.appended).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("a connected store whose rules do not admit the event is still recorded (the record is the diagnostic)", async () => {
    const h = await harness({ connections: [META] });
    const outcome = await h.ingest(
      h.envelope({ eventName: "definitely_not_a_vendor_event" } as never),
    );
    expect(outcome.status).toBe("accepted");
    expect(h.appended).toHaveLength(1);
    expect(h.calls).toEqual([]);
  });
});
