import { createHash } from "node:crypto";

import type { LiveConnection } from "@platform/ad-platforms";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  InMemoryTrackingProfileStore,
  TrackingProfileService,
  createProfile,
  ingestTrackingEvent,
  type EventRecordWriterPort,
  type HttpTransportPort,
  type TrackingEnvelope,
  type TrackingProfileStore,
} from "@platform/tracking";
import { beforeEach, describe, expect, it } from "vitest";

import { AdPlatformDeliverySync } from "./ad-platform-destinations";
import { ConnectionCredentialResolver } from "./connection-credential-resolver";
import { fakeTrackingDb } from "./testing/fake-tracking-db";
import {
  PrismaTrackingRegistryStore,
  loadTrackingRegistry,
  mappingRegistryOf,
  ruleSetRegistryOf,
} from "./tracking-registry";
import { DEFAULT_RULE_SET_KEY } from "./tracking-registry-seed";

/**
 * Tracking P1-D4 through the REAL ingest and recording runtime: a Meta and a TikTok destination synced from
 * connections, the real vendor builders, an in-memory profile store behind the real profile service. What is
 * asserted is the request each vendor would receive.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const nodeSha = { sha256Hex: (value: string) => Promise.resolve(sha(value)) };

const SECRET = "se+cr/et=:|proof1234";
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-24T10:00:00.000Z");

const META: LiveConnection = {
  platform: "meta",
  publicConfig: { platform: "meta", pixelId: "123456789012345" },
  secret: SECRET,
  testEventCode: null,
};
const TIKTOK: LiveConnection = {
  platform: "tiktok",
  publicConfig: { platform: "tiktok", pixelCode: "CABCDE1234567890" },
  secret: SECRET,
  testEventCode: null,
};

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

async function harness(profiles?: TrackingProfileStore) {
  const db = fakeTrackingDb();
  let counter = 0;
  const registryStore = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => `id-${String((counter += 1))}`,
  });
  await new AdPlatformDeliverySync({
    store: registryStore,
    connections: { listLive: () => Promise.resolve([META, TIKTOK]) },
    siteTypeOf: () => Promise.resolve("lead_site"),
    clock: { now: () => T0 },
  }).sync("t-1");
  const snapshot = await loadTrackingRegistry(registryStore, "t-1");

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
  const records: EventRecordWriterPort[] = [];
  const appended: unknown[] = [];
  const writer: EventRecordWriterPort = {
    append: (record) => {
      appended.push(record);
      return Promise.resolve();
    },
    appendHistory: (input) => {
      appended.push(input);
      return Promise.resolve();
    },
  };
  void records;

  let counterEvents = 0;
  let clockNow = T0;
  const store = profiles ?? new InMemoryTrackingProfileStore();
  const service = new TrackingProfileService({
    store,
    hasher: nodeSha,
    clock: { now: () => clockNow },
  });

  const ingest = async (
    envelope: Partial<TrackingEnvelope> & { context: TrackingEnvelope["context"] },
    at: Date,
    withProfiles = true,
  ) => {
    clockNow = at;
    counterEvents += 1;
    const complete = {
      eventId: `01919d1e-0000-7000-8000-${String(counterEvents).padStart(12, "0")}`,
      eventName: "form_submitted",
      eventVersion: 1,
      dedupId: `mb_event_${String(counterEvents)}`,
      timestamp: at.toISOString(),
      source: "server",
      environment: "production",
      consent: {
        analytics: true,
        marketing: true,
        personalization: true,
        grants: { ad_storage: true, ad_user_data: true, ad_personalization: true },
      },
      properties: {},
      tenancy: { tenantId: "t-1" },
      ...envelope,
    } as unknown as TrackingEnvelope;
    const before = calls.length;
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
            now: () => at,
          },
          records: writer,
          hasher: nodeSha,
          versions: snapshot,
          destinationState: new InMemoryDestinationState(),
          clock: { now: () => at },
        },
        destinations: snapshot,
        ruleSets: ruleSetRegistryOf(snapshot),
        ruleSetKey: DEFAULT_RULE_SET_KEY,
        hasher: nodeSha,
        clock: { now: () => at },
        ...(withProfiles ? { profiles: service } : {}),
      },
      { envelope: complete },
    );
    const sent = calls.slice(before);
    const meta = sent.find((call) => call.url.includes("graph.facebook.com"));
    const tiktok = sent.find((call) => call.url.includes("tiktok.com"));
    return {
      outcome,
      meta: (
        meta?.body["data"] as
          { user_data: Record<string, unknown>; event_source_url?: string }[] | undefined
      )?.[0],
      tiktok: (
        tiktok?.body["data"] as
          { user: Record<string, unknown>; page?: { url?: string } }[] | undefined
      )?.[0],
      sentCount: sent.length,
    };
  };

  return { ingest, store, appended };
}

const BROWSER_VISIT = {
  context: {
    session: { visitorId: "v-1", sessionId: "s-1" },
    page: { url: "https://clinic.example/offers?ttclid=tt-click-1&fbclid=AbCdEf" },
    technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 (test)" },
    identity: { phone: "+201012345678", hashStatus: "raw" },
    attribution: {
      clickIds: [
        { name: "ttclid", value: "tt-click-1", capturedAt: T0.toISOString() },
        { name: "fbclid", value: "AbCdEf", capturedAt: T0.toISOString() },
      ],
      meta: { fbp: `fb.1.${String(T0.getTime())}.111`, fbc: `fb.1.${String(T0.getTime())}.AbCdEf` },
      browserIds: { ttp: "ttp-browser-1" },
    },
  },
} as const;

describe("a later server event, completed from the visitor's earlier browser event, through the real runtime", () => {
  it("leaves for Meta and TikTok with fbc, fbp, ttclid, ttp, the phone hash, IP, user agent and page url", async () => {
    const { ingest } = await harness();
    const first = await ingest(BROWSER_VISIT, T0);
    expect(first.outcome.status).toBe("accepted");

    // Two hours later the lead is saved by the server: it knows the visitor cookie and nothing else.
    const later = new Date(T0.getTime() + 2 * 60 * 60 * 1000);
    const second = await ingest({ context: { session: { visitorId: "v-1" } } }, later);

    expect(second.outcome.status).toBe("accepted");
    expect(second.meta?.user_data).toMatchObject({
      ph: [sha("201012345678")],
      fbp: `fb.1.${String(T0.getTime())}.111`,
      fbc: `fb.1.${String(T0.getTime())}.AbCdEf`,
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0 (test)",
    });
    expect(second.meta?.event_source_url).toBe(BROWSER_VISIT.context.page.url);
    expect(second.tiktok?.user).toMatchObject({
      phone: sha("+201012345678"),
      ttclid: "tt-click-1",
      ttp: "ttp-browser-1",
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 (test)",
    });
  });

  it("without the profile step the same server event carries none of it (the proof it is the profile that fills it)", async () => {
    const { ingest } = await harness();
    await ingest(BROWSER_VISIT, T0);
    const later = new Date(T0.getTime() + 2 * 60 * 60 * 1000);
    const bare = await ingest({ context: { session: { visitorId: "v-1" } } }, later, false);

    // neither vendor has anything to match on, so neither request is made
    expect(bare.sentCount).toBe(0);
  });

  it("an event's own identity wins over the profile's, field by field", async () => {
    const { ingest } = await harness();
    await ingest(BROWSER_VISIT, T0);
    const later = new Date(T0.getTime() + 60 * 60 * 1000);
    const second = await ingest(
      {
        context: {
          session: { visitorId: "v-1" },
          identity: { phone: "+201123456789", hashStatus: "raw" },
          technical: { clientIpAddress: "198.51.100.9" },
        },
      },
      later,
    );

    expect(second.meta?.user_data).toMatchObject({
      ph: [sha("201123456789")], // the event's own phone, not the stored one
      client_ip_address: "198.51.100.9",
      client_user_agent: "Mozilla/5.0 (test)", // the gap, filled from the profile
    });
  });

  it("never stores a raw phone, email or name — the profile and the records hold hashes only", async () => {
    const { ingest, store, appended } = await harness();
    await ingest(
      {
        context: {
          ...BROWSER_VISIT.context,
          identity: {
            phone: "+201012345678",
            email: "Jane.Doe@Example.com",
            firstName: "Jane",
            hashStatus: "raw",
          },
        },
      },
      T0,
    );
    const stored = JSON.stringify((store as InMemoryTrackingProfileStore).all("t-1"));
    for (const raw of ["01012345678", "201012345678", "jane.doe", "Jane"]) {
      expect(stored.toLowerCase()).not.toContain(raw.toLowerCase());
    }
    expect(JSON.stringify(appended)).not.toContain("jane.doe@example.com");
  });

  it("an expired click id is not forwarded, though the profile once held it; a live one is", async () => {
    const store = new InMemoryTrackingProfileStore();
    // A profile stored long ago, as an earlier release would have left it: a TikTok click from 100 days back
    // and a Google one from 5 days back.
    const seeded = createProfile({
      tenantId: "t-1",
      visitorId: "v-old",
      at: new Date(T0.getTime() - 5 * DAY).toISOString(),
      now: new Date(T0.getTime() - 5 * DAY).toISOString(),
    });
    await store.persist({
      profile: {
        ...seeded,
        hashes: { phoneE164: sha("+201012345678"), phoneDigits: sha("201012345678") },
        lastIp: "203.0.113.7",
        lastUserAgent: "Mozilla/5.0 (test)",
        lastPageUrl: "https://clinic.example/offers",
        clickIds: {
          ttclid: {
            value: "tt-ancient",
            capturedAt: new Date(T0.getTime() - 100 * DAY).toISOString(),
          },
          gclid: { value: "g-live", capturedAt: new Date(T0.getTime() - 5 * DAY).toISOString() },
        },
      },
      aliases: [],
      absorbed: [],
    });
    const { ingest } = await harness(store);

    const result = await ingest({ context: { session: { visitorId: "v-old" } } }, T0);

    expect(result.tiktok?.user).toMatchObject({ phone: sha("+201012345678") });
    expect(result.tiktok?.user["ttclid"]).toBeUndefined();
    const record = JSON.stringify(result.outcome);
    expect(record).not.toContain("tt-ancient");
    expect(record).toContain("g-live"); // still on the event, inside its 90 days
  });

  it("two tenants with the same cookie id and phone never mix: the other tenant's event gets nothing", async () => {
    const { ingest, store } = await harness();
    await ingest(BROWSER_VISIT, T0);

    const later = new Date(T0.getTime() + 60 * 60 * 1000);
    const otherTenant = await ingest(
      {
        tenancy: { tenantId: "t-2" },
        context: { session: { visitorId: "v-1" } },
      },
      later,
    );

    // t-2 knows nothing about this cookie: no identity, so no vendor request is possible
    expect(otherTenant.sentCount).toBe(0);
    expect((store as InMemoryTrackingProfileStore).all("t-2")[0]?.clickIds).toEqual({});
    expect((store as InMemoryTrackingProfileStore).all("t-2")[0]?.lastIp).toBeUndefined();
    expect((store as InMemoryTrackingProfileStore).all("t-1")[0]?.lastIp).toBe("203.0.113.7");
  });

  it("a profile store outage never stops an event: it is delivered as it arrived", async () => {
    const failing: TrackingProfileStore = {
      findByCustomerId: () => Promise.reject(new Error("db down")),
      findByEmailHash: () => Promise.reject(new Error("db down")),
      findByPhoneHash: () => Promise.reject(new Error("db down")),
      findByVisitorId: () => Promise.reject(new Error("db down")),
      findByFingerprintId: () => Promise.reject(new Error("db down")),
      persist: () => Promise.reject(new Error("db down")),
      eraseCustomer: () => Promise.resolve(0),
      deleteExpiredAnonymous: () => Promise.resolve(0),
    };
    const { ingest } = await harness(failing);
    const result = await ingest(BROWSER_VISIT, T0);

    expect(result.outcome.status).toBe("accepted");
    expect(result.meta?.user_data).toMatchObject({
      ph: [sha("201012345678")],
      fbp: expect.any(String),
    });
    expect(result.tiktok?.user).toMatchObject({ ttclid: "tt-click-1" });
  });
});
