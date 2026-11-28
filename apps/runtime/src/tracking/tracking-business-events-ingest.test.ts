import { createHash } from "node:crypto";

import type { LiveConnection } from "@platform/ad-platforms";
import { RetryPolicy } from "@platform/messaging";
import {
  HttpJsonAdapter,
  InMemoryDestinationState,
  InMemoryTrackingProfileStore,
  InMemoryTrackingSettingsStore,
  TrackingProfileService,
  TrackingSettingsService,
  ingestTrackingEvent,
  leadEnvelope,
  purchaseEnvelope,
  type EventRecordWriterPort,
  type HttpTransportPort,
  type IngestOutcome,
  type IngestRuntimeDeps,
  type OrderTrackingReadModel,
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
import { TrackingRegistryHandle } from "./tracking-registry-handle";
import { DEFAULT_RULE_SET_KEY } from "./tracking-registry-seed";

/**
 * Tracking P2 Task 2 through the REAL ingest, profile and recording runtime: the business mappers' envelopes reach a
 * Meta destination synced from a connection, with the production wiring's `defaultCountryCode`, the notice-only
 * consent policy and the real vendor builder. Only the HTTP transport is a recorder.
 */
beforeEach(() => {
  expect.hasAssertions();
});

const sha = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const nodeSha = { sha256Hex: (value: string) => Promise.resolve(sha(value)) };

const SECRET = "se+cr/et=:|proof1234";
const TENANT = "t-1";
const PLACED_AT = "2026-11-27T10:00:00.000Z";
const STORE_URL = "https://shop.example/";

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

async function harness(options: {
  now: Date;
  defaultCountryCode?: string;
  siteType?: "store" | "lead_site";
}) {
  const db = fakeTrackingDb();
  let counter = 0;
  const registryStore = new PrismaTrackingRegistryStore(db.prisma as never, {
    generate: () => `id-${String((counter += 1))}`,
  });
  const sync = new AdPlatformDeliverySync({
    store: registryStore,
    connections: { listLive: () => Promise.resolve([META]) },
    siteTypeOf: () => Promise.resolve(options.siteType ?? "store"),
    clock: { now: () => options.now },
  });
  await sync.sync(TENANT);
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
    now: () => options.now.getTime(),
  });
  const writer: EventRecordWriterPort = {
    append: () => Promise.resolve(),
    appendHistory: () => Promise.resolve(),
  };
  const country =
    options.defaultCountryCode === undefined
      ? {}
      : { defaultCountryCode: options.defaultCountryCode };
  const profiles = new InMemoryTrackingProfileStore();
  const settings = new TrackingSettingsService({
    store: new InMemoryTrackingSettingsStore(),
    clock: { now: () => options.now },
    cacheTtlMs: 0,
  });

  const deps = (): IngestRuntimeDeps => {
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
          now: () => options.now,
        },
        records: writer,
        hasher: nodeSha,
        versions: snapshot,
        destinationState: new InMemoryDestinationState(),
        clock: { now: () => options.now },
        ...country,
      },
      destinations: snapshot,
      ruleSets: ruleSetRegistryOf(snapshot),
      ruleSetKey: DEFAULT_RULE_SET_KEY,
      hasher: nodeSha,
      clock: { now: () => options.now },
      profiles: new TrackingProfileService({
        store: profiles,
        hasher: nodeSha,
        clock: { now: () => options.now },
        ...country,
      }),
      consentPolicy: settings,
    };
  };

  const ingest = (envelope: TrackingEnvelope): Promise<IngestOutcome> =>
    ingestTrackingEvent(deps(), { envelope });

  const metaEvents = (): Record<string, unknown>[] =>
    calls
      .filter((call) => call.url.includes("graph.facebook.com"))
      .flatMap((call) => call.body.data as Record<string, unknown>[]);

  return { ingest, calls, metaEvents, profiles };
}

function order(overrides: Partial<OrderTrackingReadModel> = {}): OrderTrackingReadModel {
  return {
    orderId: "0193a1b2-0000-7000-8000-0000000000aa",
    currency: "EGP",
    totals: {
      subtotalMinor: 120_000,
      discountMinor: 20_000,
      taxMinor: 0,
      shippingMinor: 5_000,
      taxIncluded: false,
    },
    lines: [
      {
        productRef: "prod-1",
        variantRef: "var-1",
        name: "Shirt",
        unitPriceMinor: 60_000,
        quantity: 2,
      },
    ],
    customer: { email: "test@example.com", phone: "01012345678", name: "Mona Said" },
    placedAt: PLACED_AT,
    ...overrides,
  };
}

const CTX = { tenantId: TENANT, storeUrl: STORE_URL };
const AT = new Date("2026-11-27T10:00:30.000Z");

describe("order and lead envelopes through the production ingest path", () => {
  it("delivers a Purchase to Meta with the ord_ dedupe id, the net value, and the national phone as E.164", async () => {
    const h = await harness({ now: AT, defaultCountryCode: "20" });
    const outcome = await h.ingest(purchaseEnvelope(order(), CTX));

    expect(outcome.status).toBe("accepted");
    const events = h.metaEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_name: "Purchase",
      event_id: "ord_0193a1b2-0000-7000-8000-0000000000aa",
      event_source_url: STORE_URL,
      user_data: { em: [sha("test@example.com")], ph: [sha("201012345678")] },
      custom_data: {
        value: 1000,
        currency: "EGP",
        content_ids: ["var-1"],
        order_id: "0193a1b2-0000-7000-8000-0000000000aa",
      },
    });
    expect(JSON.stringify(h.calls)).not.toContain("01012345678");
    expect(JSON.stringify(h.calls)).not.toContain("test@example.com");
  });

  it("the same order ingested twice is two ingests with the same dedupe id (the bus collapses them by eventId)", async () => {
    const h = await harness({ now: AT, defaultCountryCode: "20" });
    const first = purchaseEnvelope(order(), CTX);
    const second = purchaseEnvelope(order(), CTX);
    expect(second.eventId).toBe(first.eventId);
    expect(second.dedupId).toBe(first.dedupId);
    await h.ingest(first);
    await h.ingest(second);
    expect(h.metaEvents().map((event) => event.event_id)).toEqual([first.dedupId, first.dedupId]);
  });

  it("accepts a 6-day-old purchase at ingest (the 7-day business window)", async () => {
    const sixDays = new Date(Date.parse(PLACED_AT) + 6 * 24 * 3_600_000);
    const h = await harness({ now: sixDays, defaultCountryCode: "20" });
    const outcome = await h.ingest(purchaseEnvelope(order(), CTX));
    expect(outcome.status).toBe("accepted");
    expect(h.metaEvents()).toHaveLength(1);
  });

  it("refuses a purchase older than 7 days with a validation failure, not a retry", async () => {
    const eightDays = new Date(Date.parse(PLACED_AT) + 8 * 24 * 3_600_000);
    const h = await harness({ now: eightDays, defaultCountryCode: "20" });
    const outcome = await h.ingest(purchaseEnvelope(order(), CTX));
    expect(outcome).toMatchObject({ status: "refused", refusal: { code: "validation_failed" } });
    expect(h.calls).toHaveLength(0);
  });

  it("delivers a Lead for a lead-form submission of a lead site", async () => {
    const h = await harness({ now: AT, defaultCountryCode: "20", siteType: "lead_site" });
    const outcome = await h.ingest(
      leadEnvelope(
        {
          leadId: "0193a1b2-0000-7000-8000-0000000000bb",
          name: "Mona Said",
          phone: "01012345678",
          phoneE164: "+201012345678",
          submittedAt: PLACED_AT,
        },
        CTX,
      ),
    );
    expect(outcome.status).toBe("accepted");
    expect(h.metaEvents()[0]).toMatchObject({
      event_name: "Lead",
      event_id: "lead_0193a1b2-0000-7000-8000-0000000000bb",
    });
  });
});

describe("defaultCountryCode wiring (P2-D7)", () => {
  /** A hand-built envelope that still carries the NATIONAL phone, as an emitter other than the mapper would. */
  function nationalPhoneEnvelope(): TrackingEnvelope {
    const base = purchaseEnvelope(order({ customer: { name: "Mona Said" } }), CTX);
    return {
      ...base,
      context: {
        ...base.context,
        identity: { ...base.context.identity, phone: "01012345678", hashStatus: "raw" },
      },
    };
  }

  it("with the market's calling code the national phone reaches Meta as the E.164 hash", async () => {
    const h = await harness({ now: AT, defaultCountryCode: "20" });
    await h.ingest(nationalPhoneEnvelope());
    expect(h.metaEvents()[0]).toMatchObject({ user_data: { ph: [sha("201012345678")] } });
  });

  it("with a Saudi store the same digits get 966 (national format differs per market)", async () => {
    const h = await harness({ now: AT, defaultCountryCode: "966" });
    const envelope = nationalPhoneEnvelope();
    await h.ingest({
      ...envelope,
      context: {
        ...envelope.context,
        identity: { ...envelope.context.identity, phone: "0512345678" },
      },
    });
    expect(h.metaEvents()[0]).toMatchObject({ user_data: { ph: [sha("966512345678")] } });
  });

  it("without any calling code the national phone is dropped, never guessed", async () => {
    const h = await harness({ now: AT });
    await h.ingest(nationalPhoneEnvelope());
    const userData = h.metaEvents()[0]?.user_data as Record<string, unknown> | undefined;
    expect(userData?.ph).toBeUndefined();
  });
});
