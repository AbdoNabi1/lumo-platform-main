import { createHash } from "node:crypto";

import type { LiveConnection } from "@platform/ad-platforms";
import { evaluateOrFalse } from "@platform/expression";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  STANDARD_RETRY,
  ingestTrackingEvent,
  type DestinationDefinition,
  type EventRecordWriterPort,
  type HttpTransportPort,
  type TrackingEnvelope,
} from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AdPlatformDeliverySync,
  BUILDER_OF,
  destinationFor,
  routingRuleSetFor,
  type SiteType,
} from "./ad-platform-destinations";
import { ConnectionCredentialResolver } from "./connection-credential-resolver";
import { fakeTrackingDb, type FakeTrackingDb } from "./testing/fake-tracking-db";
import {
  PrismaTrackingRegistryStore,
  TrackingRegistrySnapshot,
  loadTrackingRegistry,
  mappingRegistryOf,
  ruleSetRegistryOf,
} from "./tracking-registry";
import { DEFAULT_RULE_SET_KEY } from "./tracking-registry-seed";

beforeEach(() => {
  expect.hasAssertions();
});

const SECRET = "se+cr/et=:|proof1234";
const NOW = new Date("2026-11-24T10:00:00.000Z");

const META: LiveConnection = {
  platform: "meta",
  publicConfig: { platform: "meta", pixelId: "123456789012345" },
  secret: SECRET,
  testEventCode: "TEST123",
};
const TIKTOK: LiveConnection = {
  platform: "tiktok",
  publicConfig: { platform: "tiktok", pixelCode: "CABCDE1234567890" },
  secret: SECRET,
  testEventCode: null,
};
const SNAP: LiveConnection = {
  platform: "snap",
  publicConfig: { platform: "snap", pixelId: "0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab" },
  secret: SECRET,
  testEventCode: null,
};
const GA4: LiveConnection = {
  platform: "ga4",
  publicConfig: { platform: "ga4", measurementId: "G-ABCD1234" },
  secret: SECRET,
  testEventCode: null,
};

const COMMON = {
  transport: "http_json",
  channel: "server",
  consentPurpose: "marketing",
  retry: STANDARD_RETRY,
  enabled: true,
} as const;

describe("destinationFor", () => {
  it("builds exactly the documented destination for each platform, holding a reference and no secret", () => {
    const meta = destinationFor(META, "t-1");
    expect(meta).toEqual({
      ...COMMON,
      key: "meta.capi",
      platform: "meta",
      mappingProfileKey: "meta.capi.v27",
      endpoint: {
        url: "https://graph.facebook.com/v27.0/123456789012345/events",
        method: "POST",
        credentialRef: "conn://t-1/meta",
        auth: { kind: "query", param: "access_token" },
        timeoutMs: 5000,
      },
      builderKey: "meta.capi.v27",
      vendorTarget: { id: "123456789012345", testEventCode: "TEST123" },
    });
    expect(destinationFor(TIKTOK, "t-1")).toEqual({
      ...COMMON,
      key: "tiktok.events",
      platform: "tiktok",
      mappingProfileKey: "tiktok.events.v1_3",
      endpoint: {
        url: "https://business-api.tiktok.com/open_api/v1.3/event/track/",
        method: "POST",
        credentialRef: "conn://t-1/tiktok",
        auth: { kind: "header", name: "Access-Token" },
        timeoutMs: 5000,
      },
      builderKey: "tiktok.events.v1_3",
      vendorTarget: { id: "CABCDE1234567890" },
    });
    expect(destinationFor(SNAP, "t-1")).toEqual({
      ...COMMON,
      key: "snap.capi",
      platform: "snap",
      mappingProfileKey: "snap.capi.v3",
      endpoint: {
        url: "https://tr.snapchat.com/v3/0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab/events",
        method: "POST",
        credentialRef: "conn://t-1/snap",
        auth: { kind: "query", param: "access_token" },
        timeoutMs: 5000,
      },
      builderKey: "snap.capi.v3",
      vendorTarget: { id: "0b8f1c7e-1a2b-4c3d-8e9f-0123456789ab" },
    });
    expect(destinationFor(GA4, "t-1")).toEqual({
      ...COMMON,
      key: "ga4.mp",
      platform: "ga4",
      mappingProfileKey: "ga4.mp",
      endpoint: {
        url: "https://www.google-analytics.com/mp/collect?measurement_id=G-ABCD1234",
        method: "POST",
        credentialRef: "conn://t-1/ga4",
        auth: { kind: "query", param: "api_secret" },
        timeoutMs: 5000,
      },
      builderKey: "ga4.mp",
      vendorTarget: { id: "G-ABCD1234" },
    });

    for (const conn of [META, TIKTOK, SNAP, GA4]) {
      const text = JSON.stringify(destinationFor(conn, "t-1"));
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(encodeURIComponent(SECRET));
    }
    expect(BUILDER_OF).toEqual({
      meta: "meta.capi.v27",
      tiktok: "tiktok.events.v1_3",
      snap: "snap.capi.v3",
      ga4: "ga4.mp",
    });
  });

  it("refuses a platform with no server destination, without echoing the connection", () => {
    const googleAds = {
      platform: "google_ads",
      publicConfig: { platform: "google_ads", conversionId: "AW-123456789", labels: {} },
      secret: SECRET,
      testEventCode: null,
    } as unknown as LiveConnection;
    expect(() => destinationFor(googleAds, "t-1")).toThrow(
      "ad platform connection has no server destination",
    );
  });
});

describe("routingRuleSetFor", () => {
  const meta = destinationFor(META, "t-1");
  const tiktok = destinationFor(TIKTOK, "t-1");
  const allowedBy = (rules: ReturnType<typeof routingRuleSetFor>, key: string): unknown =>
    rules.rules.find((rule) => rule.then === key)?.when;

  it("admits exactly the lead site events each vendor supports", () => {
    const set = routingRuleSetFor([meta, tiktok], "lead_site", 3);
    expect(set).toMatchObject({
      id: DEFAULT_RULE_SET_KEY,
      version: 3,
      mode: "all_matches",
      onError: "fail_closed",
    });
    expect(allowedBy(set, "meta.capi")).toEqual({
      kind: "in",
      value: { kind: "ref", path: "event.name" },
      set: ["page_viewed", "form_submitted", "contact_clicked"],
    });
    expect(allowedBy(set, "tiktok.events")).toEqual({
      kind: "in",
      value: { kind: "ref", path: "event.name" },
      set: ["form_submitted", "contact_clicked"],
    });
  });

  it("never admits form_submitted for a store, and admits commerce events", () => {
    const set = routingRuleSetFor([meta, tiktok], "store", 1);
    for (const rule of set.rules) {
      expect(evaluateOrFalse(rule.when, { event: { name: "form_submitted" } })).toBe(false);
      expect(evaluateOrFalse(rule.when, { event: { name: "purchase" } })).toBe(true);
    }
    // TikTok has no server PageView; Meta does.
    const byKey = (key: string) => set.rules.find((rule) => rule.then === key)?.when;
    expect(evaluateOrFalse(byKey("tiktok.events")!, { event: { name: "page_viewed" } })).toBe(
      false,
    );
    expect(evaluateOrFalse(byKey("meta.capi")!, { event: { name: "page_viewed" } })).toBe(true);
  });

  it("never admits a commerce event for a lead site", () => {
    const set = routingRuleSetFor([meta, tiktok], "lead_site", 1);
    for (const rule of set.rules) {
      expect(evaluateOrFalse(rule.when, { event: { name: "purchase" } })).toBe(false);
      expect(evaluateOrFalse(rule.when, { event: { name: "form_submitted" } })).toBe(true);
    }
  });

  it("is empty for no destinations", () => {
    expect(routingRuleSetFor([], "store", 1).rules).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------ the sync

interface World {
  readonly db: FakeTrackingDb;
  readonly store: PrismaTrackingRegistryStore;
  readonly sync: AdPlatformDeliverySync;
  readonly live: LiveConnection[];
  siteType: SiteType;
}

function world(initial: LiveConnection[] = []): World {
  const db = fakeTrackingDb();
  let counter = 0;
  const store = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => `id-${String((counter += 1))}`,
  });
  const live = [...initial];
  const state = { siteType: "lead_site" as SiteType };
  const sync = new AdPlatformDeliverySync({
    store,
    connections: { listLive: () => Promise.resolve([...live]) },
    siteTypeOf: () => Promise.resolve(state.siteType),
    clock: { now: () => NOW },
  });
  return {
    db,
    store,
    sync,
    live,
    get siteType() {
      return state.siteType;
    },
    set siteType(value) {
      state.siteType = value;
    },
  };
}

const summary = (w: World): string[] =>
  w.db.entries.map((e) => `${e.kind}:${e.key}@${String(e.version)}:${e.status}`);

describe("AdPlatformDeliverySync", () => {
  it("first sync appends one destination, one mapping and one rule set for one live connection", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");

    expect(summary(w)).toEqual([
      "destination:meta.capi@1:active",
      "mapping:meta.capi.v27@1:active",
      `rule_set:${DEFAULT_RULE_SET_KEY}@1:active`,
    ]);
    expect(w.db.entries[0]?.value).toEqual(destinationFor(META, "t-1"));
    expect(w.db.entries[1]?.value).toEqual({
      key: "meta.capi.v27",
      version: 1,
      destination: "meta.capi",
      fields: [],
    });
    expect(w.db.entries.every((e) => e.tenantId === "t-1" && e.registeredAt === NOW)).toBe(true);
    expect(JSON.stringify(w.db.entries)).not.toContain(SECRET);
  });

  it("a second sync with nothing changed appends nothing", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");
    const before = summary(w);
    await w.sync.sync("t-1");
    expect(summary(w)).toEqual(before);
  });

  it("disabling meta retires the destination and appends a rule set without it; disabling again appends nothing", async () => {
    const w = world([META, TIKTOK]);
    await w.sync.sync("t-1");
    w.live.splice(0, 1); // meta no longer live
    await w.sync.sync("t-1");

    expect(summary(w)).toEqual([
      "destination:meta.capi@1:active",
      "destination:meta.capi@2:retired",
      "destination:tiktok.events@1:active",
      "mapping:meta.capi.v27@1:active",
      "mapping:tiktok.events.v1_3@1:active",
      `rule_set:${DEFAULT_RULE_SET_KEY}@1:active`,
      `rule_set:${DEFAULT_RULE_SET_KEY}@2:active`,
    ]);
    const latest = w.db.entries.find((e) => e.kind === "rule_set" && e.version === 2);
    expect((latest?.value as { rules: { then: string }[] }).rules.map((r) => r.then)).toEqual([
      "tiktok.events",
    ]);

    const count = w.db.entries.length;
    await w.sync.sync("t-1");
    expect(w.db.entries).toHaveLength(count);
  });

  it("re-enabling an unchanged connection brings active v3 back through the real snapshot", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");
    w.live.splice(0, 1);
    await w.sync.sync("t-1");
    expect(new TrackingRegistrySnapshot(w.db.entries).resolve("meta.capi")).toBeNull();

    w.live.push(META);
    await w.sync.sync("t-1");

    expect(summary(w).filter((s) => s.startsWith("destination"))).toEqual([
      "destination:meta.capi@1:active",
      "destination:meta.capi@2:retired",
      "destination:meta.capi@3:active",
    ]);
    const snapshot = await loadTrackingRegistry(w.store, "t-1");
    expect(snapshot.resolve("meta.capi")).toEqual(destinationFor(META, "t-1"));
    expect(snapshot.destinationVersion("meta.capi")).toBe(3);
    expect(snapshot.mappingVersion("meta.capi.v27")).toBe(1);
  });

  it("changing the pixel id appends a new destination version only", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");
    w.live[0] = {
      ...META,
      publicConfig: { platform: "meta", pixelId: "999999999999999" },
    };
    await w.sync.sync("t-1");

    expect(summary(w)).toEqual([
      "destination:meta.capi@1:active",
      "destination:meta.capi@2:active",
      "mapping:meta.capi.v27@1:active",
      `rule_set:${DEFAULT_RULE_SET_KEY}@1:active`,
    ]);
    expect((w.db.entries[1]?.value as DestinationDefinition).endpoint.url).toBe(
      "https://graph.facebook.com/v27.0/999999999999999/events",
    );
  });

  it("with no live connection the first sync writes an empty active rule set that loads", async () => {
    const w = world([]);
    await w.sync.sync("t-1");

    expect(summary(w)).toEqual([`rule_set:${DEFAULT_RULE_SET_KEY}@1:active`]);
    const snapshot = await loadTrackingRegistry(w.store, "t-1");
    expect(snapshot.resolveRuleSet(DEFAULT_RULE_SET_KEY)).toMatchObject({ rules: [] });
    await w.sync.sync("t-1");
    expect(w.db.entries).toHaveLength(1);
  });

  it("a site type change appends a new rule set version and nothing else", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");
    w.siteType = "store";
    await w.sync.sync("t-1");

    expect(summary(w)).toEqual([
      "destination:meta.capi@1:active",
      "mapping:meta.capi.v27@1:active",
      `rule_set:${DEFAULT_RULE_SET_KEY}@1:active`,
      `rule_set:${DEFAULT_RULE_SET_KEY}@2:active`,
    ]);
  });

  it("keeps the rules of destinations it does not manage, and retires a seeded placeholder of its own key", async () => {
    const w = world([]);
    await w.store.withTenantRegistryTransaction("t-1", async (writer) => {
      await writer.append({
        kind: "destination",
        key: "meta.capi",
        version: 1,
        status: "active",
        value: { key: "meta.capi", seeded: true },
        at: NOW,
      });
      await writer.append({
        kind: "rule_set",
        key: DEFAULT_RULE_SET_KEY,
        version: 1,
        status: "active",
        value: {
          id: DEFAULT_RULE_SET_KEY,
          version: 1,
          mode: "all_matches",
          onError: "fail_closed",
          rules: [
            {
              id: "route.meta.capi",
              priority: 1,
              when: { kind: "literal", value: true },
              then: "meta.capi",
            },
            {
              id: "route.pinterest.capi",
              priority: 2,
              when: { kind: "literal", value: true },
              then: "pinterest.capi",
            },
          ],
        },
        at: NOW,
      });
    });
    await w.sync.sync("t-1");

    const entries = w.db.entries;
    expect(
      entries.filter((e) => e.key === "meta.capi").map((e) => `${String(e.version)}:${e.status}`),
    ).toEqual(["1:active", "2:retired"]);
    const latest = entries.filter((e) => e.kind === "rule_set").at(-1);
    expect((latest?.value as { rules: { then: string }[] }).rules.map((r) => r.then)).toEqual([
      "pinterest.capi",
    ]);
  });

  it("a failing middle append rolls the whole sync back", async () => {
    const w = world([META, TIKTOK]);
    w.db.failCreateNumber = 3;
    await expect(w.sync.sync("t-1")).rejects.toThrow("registry write failed");
    expect(w.db.entries).toEqual([]);

    w.db.failCreateNumber = null;
    await w.sync.sync("t-1");
    expect(summary(w)).toHaveLength(5);
  });

  it("two concurrent syncs end with a loadable registry with contiguous versions and both destinations", async () => {
    const w = world([META]);
    const first = w.sync.sync("t-1");
    w.live.push(TIKTOK);
    const second = w.sync.sync("t-1");
    await Promise.all([first, second]);

    const snapshot = await loadTrackingRegistry(w.store, "t-1");
    expect(snapshot.resolve("meta.capi")).not.toBeNull();
    expect(snapshot.resolve("tiktok.events")).not.toBeNull();
    const rules = snapshot.resolveRuleSet(DEFAULT_RULE_SET_KEY)?.rules.map((r) => r.then);
    expect(rules).toEqual(["meta.capi", "tiktok.events"]);
    for (const kind of ["destination", "mapping", "rule_set"]) {
      const byKey = new Map<string, number[]>();
      for (const e of w.db.entries.filter((x) => x.kind === kind)) {
        byKey.set(e.key, [...(byKey.get(e.key) ?? []), e.version]);
      }
      for (const versions of byKey.values()) {
        expect(versions).toEqual(versions.map((_, i) => i + 1));
      }
    }
  });

  it("reads the live connections inside the locked transaction", async () => {
    const w = world([META]);
    const order: string[] = [];
    const sync = new AdPlatformDeliverySync({
      store: w.store,
      connections: {
        listLive: () => {
          order.push(`read after ${String(w.db.statements.length)} statements`);
          return Promise.resolve([META]);
        },
      },
      siteTypeOf: () => Promise.resolve("lead_site"),
      clock: { now: () => NOW },
    });
    await sync.sync("t-1");
    // set_config + pg_advisory_xact_lock had both run before the connections were read.
    expect(order).toEqual(["read after 2 statements"]);
  });
});

// ------------------------------------------------------------------ through the real recording runtime

const nodeSha = {
  sha256Hex: (s: string) => Promise.resolve(createHash("sha256").update(s).digest("hex")),
};
const EVENT_TIME_MS = NOW.getTime() - 1_000;

function envelope(eventName: string): TrackingEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName,
    eventVersion: 1,
    dedupId: "lead_0193a1b2-0000-7000-8000-000000000001",
    timestamp: new Date(EVENT_TIME_MS).toISOString(),
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
      technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
      identity: { email: "jane.doe@example.com", hashStatus: "raw" },
    },
    properties: {},
    tenancy: { tenantId: "t-1" },
  } as unknown as TrackingEnvelope;
}

async function ingest(w: World, eventName: string, secret: string | null) {
  const snapshot = await loadTrackingRegistry(w.store, "t-1");
  const calls: { url: string; headers: Readonly<Record<string, string>>; body: unknown }[] = [];
  const http: HttpTransportPort = {
    send: (input) => {
      calls.push({
        url: input.url,
        headers: input.headers,
        body: input.body === undefined ? undefined : JSON.parse(input.body),
      });
      return Promise.resolve({ status: 200 });
    },
  };
  const adapter = new HttpJsonAdapter({
    http,
    credentials: new ConnectionCredentialResolver({
      connections: { openSecret: () => Promise.resolve(secret) },
      fallback: { resolve: () => Promise.resolve(null) },
    }),
    now: () => NOW.getTime(),
  });
  const appended: unknown[] = [];
  const records: EventRecordWriterPort = {
    append: (record) => {
      appended.push(record);
      return Promise.resolve();
    },
    appendHistory: (input) => {
      appended.push(input);
      return Promise.resolve();
    },
  };
  const outcome = await ingestTrackingEvent(
    {
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
          now: () => NOW,
        },
        records,
        hasher: nodeSha,
        versions: snapshot,
        destinationState: new InMemoryDestinationState(),
        clock: { now: () => NOW },
      },
      destinations: snapshot,
      ruleSets: ruleSetRegistryOf(snapshot),
      ruleSetKey: DEFAULT_RULE_SET_KEY,
      hasher: nodeSha,
      clock: { now: () => NOW },
    },
    { envelope: envelope(eventName) },
  );
  return { outcome, calls, appended };
}

describe("a synced registry through the real ingest and recording runtime", () => {
  it("sends a lead to Meta in the vendor shape, with the secret only on the wire", async () => {
    const w = world([META, TIKTOK]);
    await w.sync.sync("t-1");
    const { outcome, calls, appended } = await ingest(w, "form_submitted", SECRET);

    expect(outcome.status).toBe("accepted");
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([
      "https://graph.facebook.com/v27.0/123456789012345/events",
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
    ]);
    const meta = calls[0];
    expect(meta?.url).toContain(`access_token=${encodeURIComponent(SECRET)}`);
    expect((meta?.body as { data: { event_name: string }[] }).data[0]?.event_name).toBe("Lead");
    expect(calls[1]?.headers["Access-Token"] ?? calls[1]?.headers["access-token"]).toBe(SECRET);

    const recorded = JSON.stringify([appended, w.db.entries]);
    expect(recorded).not.toContain(SECRET);
    expect(recorded).not.toContain(encodeURIComponent(SECRET));
    expect(recorded).not.toContain("jane.doe@example.com");
  });

  it("routes a lead site's page view to Meta only, and never a commerce event to anyone", async () => {
    const w = world([META, TIKTOK]);
    await w.sync.sync("t-1");

    const view = await ingest(w, "page_viewed", SECRET);
    expect(view.calls.map((c) => c.url.split("?")[0])).toEqual([
      "https://graph.facebook.com/v27.0/123456789012345/events",
    ]);

    const purchase = await ingest(w, "purchase", SECRET);
    expect(purchase.calls).toEqual([]);
  });

  it("an unresolved connection credential is a recorded failure, not a request", async () => {
    const w = world([META]);
    await w.sync.sync("t-1");
    const { calls, appended } = await ingest(w, "form_submitted", null);

    expect(calls).toEqual([]);
    expect(JSON.stringify(appended)).toContain("credential conn://t-1/meta unresolved");
  });
});
