import { connectionsForDelivery, wireAdPlatforms } from "@platform/ad-platforms";
import type { HttpTransportPort } from "@platform/tracking";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdPlatformTestEventSender } from "./test-event-sender";

/**
 * Tracking P2-D11: the synthetic purchase sent to ONE ad platform. The connections are the REAL ad platforms context
 * (in-memory repository, stub vault) so a saved test code and an opened token are what the runtime really reads; the
 * network is an injected transport that records every request. Nothing here can reach an event store, because the
 * sender has no dependency on one.
 */

beforeEach(() => {
  expect.hasAssertions();
});

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const META_TOKEN = "EAABmetaTOKEN1234567890";
const TIKTOK_TOKEN = "tiktokTOKEN-abcdef-123456";
const GA4_SECRET = "ga4SECRET_abcdef123456";
const SAVED_CODE = "SAVED123";
const UUID = "0192f0aa-1111-7000-8000-000000000001";

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

function transportOf(
  answer: (sent: Sent) => { status: number; body?: Record<string, unknown> } | Error,
) {
  const sent: Sent[] = [];
  const transport: HttpTransportPort = {
    send: (input) => {
      const request: Sent = {
        url: input.url,
        method: input.method,
        headers: input.headers,
        body: JSON.parse(input.body ?? "{}") as Record<string, unknown>,
      };
      sent.push(request);
      const reply = answer(request);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { transport, sent };
}

async function connect(
  platform: "meta" | "tiktok" | "snap" | "ga4" | "google_ads",
  options: { tenantId?: string; testEventCode?: string; enabled?: boolean } = {},
) {
  return saveConnection(shared, platform, options);
}

let shared: ReturnType<typeof realWiring>;

function realWiring() {
  const wired = wireAdPlatforms({
    clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
    idGenerator: { generate: () => "01930000-0000-7000-8000-000000000001" },
  });
  return { wired, connections: connectionsForDelivery(wired.internal) };
}

const CONFIG = {
  meta: { platform: "meta", pixelId: "123456789012345" },
  tiktok: { platform: "tiktok", pixelCode: "CABCDEFG1234567890" },
  snap: { platform: "snap", pixelId: "00000000-0000-4000-8000-000000000001" },
  ga4: { platform: "ga4", measurementId: "G-ABCD1234" },
  google_ads: { platform: "google_ads", conversionId: "AW-123456789", labels: {} },
} as const;
const TOKEN = {
  meta: META_TOKEN,
  tiktok: TIKTOK_TOKEN,
  snap: "snapTOKEN-abcdef-123456",
  ga4: GA4_SECRET,
  google_ads: undefined,
} as const;

async function saveConnection(
  wiring: ReturnType<typeof realWiring>,
  platform: keyof typeof CONFIG,
  options: { tenantId?: string; testEventCode?: string; enabled?: boolean },
) {
  const token = TOKEN[platform];
  const response = await wiring.wired.controller.save({
    tenantId: options.tenantId ?? TENANT,
    platform,
    enabled: options.enabled ?? true,
    publicConfig: CONFIG[platform],
    ...(token === undefined ? {} : { secret: token }),
    ...(options.testEventCode === undefined ? {} : { testEventCode: options.testEventCode }),
    expectedVersion: 0,
  });
  expect(response.status).toBe(200);
}

function senderOf(
  transport: HttpTransportPort,
  extra: { logger?: { info: (m: string, f?: Record<string, unknown>) => void } } = {},
) {
  return new AdPlatformTestEventSender({
    connections: shared.connections,
    transport,
    storeUrls: { storeUrlOf: () => Promise.resolve("https://shop.example.net/") },
    clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
    newId: () => UUID,
    ...extra,
  });
}

beforeEach(() => {
  shared = realWiring();
});

describe("Meta and TikTok: a synthetic purchase with a request-scoped test code", () => {
  it("sends one Purchase with id test_<uuid> and the code from the request, token as access_token", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    const { transport, sent } = transportOf(() => ({ status: 200, body: { events_received: 1 } }));

    const outcome = await senderOf(transport).send({
      tenantId: TENANT,
      platform: "meta",
      testEventCode: "FROMBODY9",
    });

    expect(outcome).toEqual({
      ok: true,
      result: {
        platform: "meta",
        status: "sent",
        vendorStatus: 200,
        sentAt: "2026-11-28T10:00:00.000Z",
      },
    });
    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      `https://graph.facebook.com/v27.0/123456789012345/events?access_token=${META_TOKEN}`,
    );
    expect(request.body.test_event_code).toBe("FROMBODY9");
    const event = (request.body.data as Record<string, unknown>[])[0]!;
    expect(event.event_name).toBe("Purchase");
    expect(event.event_id).toBe(`test_${UUID}`);
    expect((event.custom_data as Record<string, unknown>).order_id).toBe(`test_${UUID}`);
    expect(event.event_source_url).toBe("https://shop.example.net/");
    expect(event.event_time).toBe(Date.parse("2026-11-28T10:00:00.000Z") / 1000);
  });

  it("uses the saved code when the request has none, and never changes the saved one", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    const { transport, sent } = transportOf(() => ({ status: 200, body: {} }));
    const sender = senderOf(transport);

    await sender.send({ tenantId: TENANT, platform: "meta" });
    await sender.send({ tenantId: TENANT, platform: "meta", testEventCode: "ONESHOT1" });
    await sender.send({ tenantId: TENANT, platform: "meta" });

    expect(sent.map((request) => request.body.test_event_code)).toEqual([
      SAVED_CODE,
      "ONESHOT1",
      SAVED_CODE,
    ]);
    const saved = (await shared.connections.listLive(TENANT)).find((c) => c.platform === "meta");
    expect(saved?.testEventCode).toBe(SAVED_CODE);
  });

  it("answers TEST_CODE_REQUIRED with where to find the code when there is neither, and sends nothing", async () => {
    await connect("meta");
    await connect("tiktok");
    const { transport, sent } = transportOf(() => ({ status: 200 }));
    const sender = senderOf(transport);

    const meta = await sender.send({ tenantId: TENANT, platform: "meta" });
    const tiktok = await sender.send({ tenantId: TENANT, platform: "tiktok" });

    expect(meta).toMatchObject({ ok: false, code: "TEST_CODE_REQUIRED" });
    expect(tiktok).toMatchObject({ ok: false, code: "TEST_CODE_REQUIRED" });
    if (!meta.ok) expect(meta.message).toMatch(/Events Manager/);
    if (!tiktok.ok) expect(tiktok.message).toMatch(/Events Manager/);
    expect(sent).toHaveLength(0);
  });

  it("TikTok: the code is in the body, the token in the Access-Token header (never the URL)", async () => {
    await connect("tiktok");
    const { transport, sent } = transportOf(() => ({
      status: 200,
      body: { code: 0, message: "OK" },
    }));

    const outcome = await senderOf(transport).send({
      tenantId: TENANT,
      platform: "tiktok",
      testEventCode: "TEST4242",
    });

    expect(outcome).toMatchObject({ ok: true, result: { platform: "tiktok", status: "sent" } });
    const request = sent[0]!;
    expect(request.url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(request.headers["Access-Token"]).toBe(TIKTOK_TOKEN);
    expect(request.url).not.toContain(TIKTOK_TOKEN);
    expect(request.body.test_event_code).toBe("TEST4242");
    expect(request.body.event_source_id).toBe("CABCDEFG1234567890");
    const event = (request.body.data as Record<string, unknown>[])[0]!;
    expect(event.event).toBe("Purchase");
    expect(event.event_id).toBe(`test_${UUID}`);
  });

  it("TikTok answers 200 with a non-zero code: that is rejected", async () => {
    await connect("tiktok");
    const { transport } = transportOf(() => ({
      status: 200,
      body: { code: 40002, message: "bad pixel" },
    }));

    const outcome = await senderOf(transport).send({
      tenantId: TENANT,
      platform: "tiktok",
      testEventCode: "TEST4242",
    });

    expect(outcome).toEqual({
      ok: true,
      result: {
        platform: "tiktok",
        status: "rejected",
        vendorStatus: 200,
        sentAt: "2026-11-28T10:00:00.000Z",
      },
    });
  });

  it("a vendor 4xx is rejected with its status and nothing else", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    const { transport } = transportOf(() => ({
      status: 400,
      body: { error: { message: `Invalid token ${META_TOKEN}` } },
    }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "meta" });

    expect(outcome).toEqual({
      ok: true,
      result: {
        platform: "meta",
        status: "rejected",
        vendorStatus: 400,
        sentAt: "2026-11-28T10:00:00.000Z",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(META_TOKEN);
  });

  it("a network failure is rejected without a vendor status and never echoes the token", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    const { transport } = transportOf(
      () => new Error(`connect ECONNREFUSED graph.facebook.com?access_token=${META_TOKEN}`),
    );

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "meta" });

    expect(outcome).toEqual({
      ok: true,
      result: { platform: "meta", status: "rejected", sentAt: "2026-11-28T10:00:00.000Z" },
    });
    expect(JSON.stringify(outcome)).not.toContain(META_TOKEN);
  });

  it("gives every send its own test id", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    const ids = ["0192f0aa-1111-7000-8000-00000000000a", "0192f0aa-1111-7000-8000-00000000000b"];
    let n = 0;
    const { transport, sent } = transportOf(() => ({ status: 200 }));
    const sender = new AdPlatformTestEventSender({
      connections: shared.connections,
      transport,
      storeUrls: { storeUrlOf: () => Promise.resolve(null) },
      clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
      newId: () => ids[n++ % 2]!,
    });

    await sender.send({ tenantId: TENANT, platform: "meta" });
    await sender.send({ tenantId: TENANT, platform: "meta" });

    const eventIds = sent.map(
      (request) =>
        ((request.body.data as Record<string, unknown>[])[0] as { event_id: string }).event_id,
    );
    expect(eventIds).toEqual([`test_${ids[0]}`, `test_${ids[1]}`]);
    // No store address known: still a valid https source url (the vendor refuses none).
    const event = (sent[0]!.body.data as Record<string, unknown>[])[0]!;
    expect(String(event.event_source_url)).toMatch(/^https:\/\//);
  });
});

describe("GA4: the debug endpoint", () => {
  it("posts to /debug/mp/collect and returns the validation messages", async () => {
    await connect("ga4");
    const { transport, sent } = transportOf(() => ({
      status: 200,
      body: {
        validationMessages: [
          {
            fieldPath: "events[0].params.currency",
            description: "Value must be a valid currency code.",
            validationCode: "VALUE_INVALID",
          },
        ],
      },
    }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "ga4" });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(
      `https://www.google-analytics.com/debug/mp/collect?measurement_id=G-ABCD1234&api_secret=${GA4_SECRET}`,
    );
    const event = (sent[0]!.body.events as Record<string, unknown>[])[0]!;
    expect(event.name).toBe("purchase");
    expect((event.params as Record<string, unknown>).transaction_id).toBe(`test_${UUID}`);
    expect(sent[0]!.body.client_id).toMatch(/^\d{10}\.\d{10}$/);
    expect(outcome).toEqual({
      ok: true,
      result: {
        platform: "ga4",
        status: "rejected",
        vendorStatus: 200,
        messages: ["events[0].params.currency: Value must be a valid currency code."],
        sentAt: "2026-11-28T10:00:00.000Z",
      },
    });
  });

  it("no validation messages means the event is valid: sent, empty messages", async () => {
    await connect("ga4");
    const { transport } = transportOf(() => ({ status: 200, body: { validationMessages: [] } }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "ga4" });

    expect(outcome).toEqual({
      ok: true,
      result: {
        platform: "ga4",
        status: "sent",
        vendorStatus: 200,
        messages: [],
        sentAt: "2026-11-28T10:00:00.000Z",
      },
    });
  });

  it("ignores a test code (GA4 has none) and strips the secret from vendor text", async () => {
    await connect("ga4");
    const { transport, sent } = transportOf(() => ({
      status: 200,
      body: {
        validationMessages: [
          { fieldPath: "api_secret", description: `bad secret ${GA4_SECRET}`, validationCode: "X" },
        ],
      },
    }));

    const outcome = await senderOf(transport).send({
      tenantId: TENANT,
      platform: "ga4",
      testEventCode: "WHATEVER",
    });

    expect(JSON.stringify(sent[0]!.body)).not.toContain("WHATEVER");
    expect(JSON.stringify(outcome)).not.toContain(GA4_SECRET);
    expect(outcome).toMatchObject({ ok: true, result: { status: "rejected" } });
  });

  it("caps the messages it returns", async () => {
    await connect("ga4");
    const many = Array.from({ length: 15 }, (_, index) => ({
      fieldPath: `f${String(index)}`,
      description: "x".repeat(900),
      validationCode: "X",
    }));
    const { transport } = transportOf(() => ({ status: 200, body: { validationMessages: many } }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "ga4" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.messages?.length).toBe(10);
      expect(outcome.result.messages?.every((message) => message.length <= 300)).toBe(true);
    }
  });
});

describe("what is not sent", () => {
  it("Snap has no test mode: TEST_NOT_SUPPORTED with a plain message, nothing sent", async () => {
    await connect("snap");
    const { transport, sent } = transportOf(() => ({ status: 200 }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "snap" });

    expect(outcome).toMatchObject({ ok: false, code: "TEST_NOT_SUPPORTED" });
    if (!outcome.ok) expect(outcome.message).toMatch(/Snapchat/);
    expect(sent).toHaveLength(0);
  });

  it("Google Ads has no server events: TEST_NOT_SUPPORTED", async () => {
    await connect("google_ads");
    const { transport, sent } = transportOf(() => ({ status: 200 }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "google_ads" });

    expect(outcome).toMatchObject({ ok: false, code: "TEST_NOT_SUPPORTED" });
    expect(sent).toHaveLength(0);
  });

  it("an unknown platform name is not supported either", async () => {
    const { transport, sent } = transportOf(() => ({ status: 200 }));

    const outcome = await senderOf(transport).send({ tenantId: TENANT, platform: "pinterest" });

    expect(outcome).toMatchObject({ ok: false, code: "TEST_NOT_SUPPORTED" });
    expect(sent).toHaveLength(0);
  });

  it("no connection, a disabled one and another shop's: NOT_CONNECTED, nothing sent", async () => {
    await connect("meta", { tenantId: OTHER, testEventCode: SAVED_CODE });
    await connect("tiktok", { enabled: false });
    const { transport, sent } = transportOf(() => ({ status: 200 }));
    const sender = senderOf(transport);

    const none = await sender.send({ tenantId: TENANT, platform: "meta", testEventCode: "ABC" });
    const disabled = await sender.send({
      tenantId: TENANT,
      platform: "tiktok",
      testEventCode: "ABC",
    });
    const ga4 = await sender.send({ tenantId: TENANT, platform: "ga4" });

    expect(none).toMatchObject({ ok: false, code: "NOT_CONNECTED" });
    expect(disabled).toMatchObject({ ok: false, code: "NOT_CONNECTED" });
    expect(ga4).toMatchObject({ ok: false, code: "NOT_CONNECTED" });
    expect(sent).toHaveLength(0);
  });

  it("an unreadable connection store is UNAVAILABLE, with no detail", async () => {
    const { transport, sent } = transportOf(() => ({ status: 200 }));
    const sender = new AdPlatformTestEventSender({
      connections: {
        listLive: () => Promise.reject(new Error(`boom ${META_TOKEN}`)),
      },
      transport,
      storeUrls: { storeUrlOf: () => Promise.resolve(null) },
      clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
      newId: () => UUID,
    });

    const outcome = await sender.send({ tenantId: TENANT, platform: "meta" });

    expect(outcome).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(JSON.stringify(outcome)).not.toContain(META_TOKEN);
    expect(sent).toHaveLength(0);
  });
});

describe("what never leaves", () => {
  it("no raw customer value in the request body and no secret or PII in the result or the logs", async () => {
    await connect("meta", { testEventCode: SAVED_CODE });
    await connect("ga4");
    const info = vi.fn();
    const { transport, sent } = transportOf((request) =>
      request.url.includes("graph.facebook.com")
        ? { status: 200, body: { events_received: 1 } }
        : { status: 200, body: { validationMessages: [] } },
    );
    const sender = senderOf(transport, { logger: { info } });

    const outcomes = [
      await sender.send({ tenantId: TENANT, platform: "meta" }),
      await sender.send({ tenantId: TENANT, platform: "ga4" }),
    ];

    const wire = JSON.stringify(sent.map((request) => request.body));
    expect(wire).not.toMatch(/@/);
    // The visitor address is the documentation range (a vendor wants it raw); no real customer value exists.
    expect(wire).not.toContain("test.event");
    expect(wire).not.toContain("Test Event");
    for (const text of [JSON.stringify(outcomes), JSON.stringify(info.mock.calls)]) {
      expect(text).not.toContain(META_TOKEN);
      expect(text).not.toContain(GA4_SECRET);
      expect(text).not.toContain(SAVED_CODE);
      expect(text).not.toMatch(/@/);
    }
    expect(info).toHaveBeenCalled();
  });
});
