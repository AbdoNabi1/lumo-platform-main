import { createHash } from "node:crypto";

import type { LiveConnection } from "@platform/ad-platforms";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  ingestTrackingEvent,
  type EventRecordWriterPort,
  type HttpTransportPort,
  type TrackingEnvelope,
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
 * Tracking P1-D8 through the REAL ingest and recording runtime: a bot-scored page view is recorded but reaches no ad
 * platform, a real order or lead never does that, whatever its score. Meta and TikTok destinations are synced from
 * connections and use the real vendor builders; what is asserted is what each vendor would receive.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const nodeSha = { sha256Hex: (value: string) => Promise.resolve(sha(value)) };

const SECRET = "se+cr/et=:|proof1234";
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
}

async function harness(siteType: "store" | "lead_site" = "lead_site") {
  const db = fakeTrackingDb();
  let counter = 0;
  const registryStore = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => `id-${String((counter += 1))}`,
  });
  await new AdPlatformDeliverySync({
    store: registryStore,
    connections: { listLive: () => Promise.resolve([META, TIKTOK]) },
    siteTypeOf: () => Promise.resolve(siteType),
    clock: { now: () => T0 },
  }).sync("t-1");
  const snapshot = await loadTrackingRegistry(registryStore, "t-1");

  const calls: Call[] = [];
  const http: HttpTransportPort = {
    send: (input) => {
      calls.push({ url: input.url });
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

  const ingest = async (
    envelope: Partial<TrackingEnvelope> & { context: TrackingEnvelope["context"] },
    at: Date,
  ) => {
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
      },
      { envelope: complete },
    );
    const sent = calls.slice(before);
    return {
      outcome,
      sentTo: sent.map((call) => (call.url.includes("graph.facebook.com") ? "meta" : "tiktok")),
    };
  };

  return { ingest, appended };
}

const visit = (name: string, botScore: number, extra: Partial<TrackingEnvelope> = {}) => ({
  eventName: name,
  source: "web" as const,
  eventOrigin: "browser" as const,
  context: {
    session: { visitorId: "v-1", sessionId: "s-1" },
    page: { url: "https://clinic.example/offers" },
    identity: { hashStatus: "raw" as const, phone: "+201001234567" },
    technical: { clientIpAddress: "203.0.113.7", clientUserAgent: "Mozilla/5.0 test", botScore },
  },
  ...extra,
});

describe("bot score through the real ingest and delivery", () => {
  it("control: a human page view reaches the ad platforms", async () => {
    const { ingest } = await harness();
    const result = await ingest(visit("page_viewed", 0), T0);
    expect(result.outcome.status).toBe("accepted");
    expect(result.sentTo.length).toBeGreaterThan(0);
  });

  it("a bot's page view is recorded with the visible reason `bot` and reaches no destination", async () => {
    const { ingest, appended } = await harness();
    const result = await ingest(visit("page_viewed", 95), T0);

    expect(result.outcome.status).toBe("accepted");
    expect(result.sentTo).toEqual([]);
    if (result.outcome.status !== "accepted") return;
    expect(result.outcome.routing.routed).toEqual([]);
    expect(result.outcome.routing.excluded.map((entry) => entry.reason.code)).toContain("bot");
    // still logged: the event record was written with the exclusion on it
    expect(JSON.stringify(appended)).toContain('"exclusionReason":"bot"');
  });

  it("a real lead from a browser scored as a bot is still delivered", async () => {
    const { ingest } = await harness();
    const lead = await ingest(visit("form_submitted", 100, { dedupId: "lead_abc123" }), T0);
    expect(lead.outcome.status).toBe("accepted");
    expect(lead.sentTo.length).toBeGreaterThan(0);
  });

  it("a real order is never dropped, whatever the score", async () => {
    const { ingest } = await harness("store");
    const order = await ingest(
      visit("purchase", 100, {
        source: "server",
        eventOrigin: "server",
        payload: { orderId: "o-1", valueMinor: 150_000, currency: "EGP" },
      }),
      T0,
    );
    expect(order.outcome.status).toBe("accepted");
    expect(order.sentTo.length).toBeGreaterThan(0);
  });
});
