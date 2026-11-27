import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signEdgeRequest } from "./tracking-edge-signature";
import { trackingMessageId, type TrackingCookieKeeper } from "./public-tracking-routes";
import {
  COLLECT_URL,
  EDGE_SECRET,
  NOW_SECONDS,
  SHOP,
  buildEdgeApp,
  edgeBody,
  sendSigned,
  type EdgeApp,
  type EdgeAppOptions,
  type PublishedRecord,
} from "./testing/tracking-edge-harness";

beforeEach(() => {
  expect.hasAssertions();
});

const apps: FastifyInstance[] = [];
async function boot(options: EdgeAppOptions = {}): Promise<EdgeApp> {
  const built = await buildEdgeApp(options);
  apps.push(built.app);
  return built;
}
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

interface DecodedEnvelope {
  eventId: string;
  tenancy: unknown;
  context: {
    technical: { clientIpAddress: string; clientUserAgent: string; deviceType: string };
    page: unknown;
    attribution: {
      clickIds: { name: string }[];
      meta: { fbp: string };
      browserIds: unknown;
    };
  };
}

/** The integration event the sink received, decoded from its bytes. */
function decoded(record: PublishedRecord | undefined): {
  messageId: string;
  type: string;
  tenantId: string;
  payload: { envelope: DecodedEnvelope };
} {
  expect(record).toBeDefined();
  return JSON.parse(new TextDecoder().decode(record!.value)) as never;
}

describe("POST /public/tracking/collect — accepted", () => {
  it("answers 202 {eventId, cookies: []} and hands one tracking.event.captured.v1 record to the sink", async () => {
    const { app, published } = await boot();

    const res = await sendSigned(app);

    expect(res.statusCode).toBe(202);
    const body = res.json() as { eventId: string; cookies: unknown[] };
    expect(body.cookies).toEqual([]);
    expect(published).toHaveLength(1);
    const record = published[0]!;
    expect(record.topic).toBe("tracking.event.captured.v1");
    expect(record.key).toBe(SHOP);
    expect(record.headers["tenantId"]).toBe(SHOP);
    expect(record.headers["messageId"]).toBe(body.eventId);
    const event = decoded(record);
    expect(event.type).toBe("tracking.event.captured");
    expect(event.tenantId).toBe(SHOP);
    expect(event.messageId).toBe(body.eventId);
    expect(event.payload.envelope.eventId).toBe(body.eventId);
  });

  it("completes the envelope from the signed client context (ip, ua, page, referrer, cookies)", async () => {
    const { app, published } = await boot();

    const body = edgeBody();
    (body["client"] as { cookies: Record<string, string> }).cookies = {
      fbp: "fb.1.1764000000.1234567890",
      ttp: "ttp-value-1",
      scid: "scid-value-1",
      ga: "GA1.1.111111111.1764000000",
    };
    await sendSigned(app, body);

    const envelope = decoded(published[0]).payload.envelope;
    expect(envelope.tenancy).toEqual({ tenantId: SHOP });
    expect(envelope.context.technical.clientIpAddress).toBe("203.0.113.7");
    expect(envelope.context.technical.clientUserAgent).toContain("Macintosh");
    expect(envelope.context.technical.deviceType).toBe("desktop");
    expect(envelope.context.page).toEqual({
      url: "https://shop.example/landing?gclid=CJ-abc&utm_source=google",
      referrer: "https://www.google.com/",
    });
    expect(envelope.context.attribution.clickIds.map((id) => id.name)).toContain("gclid");
    expect(envelope.context.attribution.meta.fbp).toBe("fb.1.1764000000.1234567890");
    expect(envelope.context.attribution.browserIds).toEqual({
      ttp: "ttp-value-1",
      scid: "scid-value-1",
      gaClientId: "111111111.1764000000",
    });
  });

  it("ignores a tenant claimed inside the event: the signed shop wins", async () => {
    const { app, published } = await boot();
    const body = edgeBody();
    (body["event"] as Record<string, unknown>)["tenancy"] = { tenantId: "shop-victim" };

    expect((await sendSigned(app, body)).statusCode).toBe(202);

    expect(decoded(published[0]).payload.envelope.tenancy).toEqual({ tenantId: SHOP });
  });

  it("a business event id that is not a UUID gets a stable UUID message id, so a retry collapses", async () => {
    const { app, published } = await boot();
    const body = edgeBody();
    (body["event"] as Record<string, unknown>)["eventId"] = "lead_0192f0aa";

    const first = await sendSigned(app, body);
    await sendSigned(app, body);

    expect(first.statusCode).toBe(202);
    expect((first.json() as { eventId: string }).eventId).toBe("lead_0192f0aa");
    const ids = published.map((record) => record.headers["messageId"]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(decoded(published[0]).payload.envelope.eventId).toBe("lead_0192f0aa");
  });
});

describe("trackingMessageId", () => {
  it("keeps a UUID as it is, and derives a per-tenant UUID for anything else", () => {
    const uuid = "0192F0AA-0000-7000-8000-000000000001";
    expect(trackingMessageId("t-1", uuid)).toBe(uuid.toLowerCase());
    expect(trackingMessageId("t-1", "ord_42")).toBe(trackingMessageId("t-1", "ord_42"));
    expect(trackingMessageId("t-1", "ord_42")).not.toBe(trackingMessageId("t-2", "ord_42"));
    expect(trackingMessageId("t-1", "ord_42")).not.toBe(trackingMessageId("t-1", "ord_43"));
  });
});

describe("POST /public/tracking/collect — not configured", () => {
  it("answers 503 NOT_CONFIGURED when TRACKING_EDGE_SECRET is absent, and stores nothing", async () => {
    const { app, published } = await boot({ secret: null });

    const res = await sendSigned(app);

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    expect(published).toEqual([]);
  });

  it("answers 503 even for an unsigned request (nothing is read before the config check)", async () => {
    const { app, published } = await boot({ secret: null });
    const res = await sendSigned(app, edgeBody(), { signature: null, omitTimestamp: true });
    expect(res.statusCode).toBe(503);
    expect(published).toEqual([]);
  });

  it("answers 503 UNAVAILABLE when no transport sink exists", async () => {
    const { app } = await boot({ noSink: true });
    const res = await sendSigned(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });
});

describe("POST /public/tracking/collect — authentication (HMAC)", () => {
  it.each([
    ["no signature header", { signature: null }],
    ["no timestamp header", { omitTimestamp: true }],
    ["a signature of the wrong length", { signature: "abcd" }],
    ["a signature made with another secret", { secret: "another-secret-".padEnd(40, "9") }],
    ["a timestamp more than 5 minutes old (replay)", { timestamp: NOW_SECONDS - 301 }],
    ["a timestamp more than 5 minutes ahead", { timestamp: NOW_SECONDS + 301 }],
  ] as const)("refuses %s with the one 401 body and stores nothing", async (_name, options) => {
    const { app, published } = await boot();

    const res = await sendSigned(app, edgeBody(), options);

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
    expect(published).toEqual([]);
  });

  it("refuses a body altered after signing", async () => {
    const { app, published } = await boot();
    const signed = JSON.stringify(edgeBody());
    const tampered = signed.replace("page_view", "purchase");

    const res = await app.inject({
      method: "POST",
      url: COLLECT_URL,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": SHOP,
        "x-mb-ts": String(NOW_SECONDS),
        "x-mb-sig": signEdgeRequest(EDGE_SECRET, NOW_SECONDS, signed),
      },
      payload: tampered,
    });

    expect(res.statusCode).toBe(401);
    expect(published).toEqual([]);
  });

  it("accepts a timestamp at the edge of the window", async () => {
    const { app } = await boot();
    expect((await sendSigned(app, edgeBody(), { timestamp: NOW_SECONDS - 300 })).statusCode).toBe(
      202,
    );
  });

  it("an exact replay inside the window is harmless: the same message id both times", async () => {
    const { app, published } = await boot();
    const body = edgeBody();
    (body["event"] as Record<string, unknown>)["eventId"] = "0192f0aa-0000-7000-8000-00000000abcd";

    await sendSigned(app, body);
    await sendSigned(app, body);

    expect(published.map((r) => r.headers["messageId"])).toEqual([
      "0192f0aa-0000-7000-8000-00000000abcd",
      "0192f0aa-0000-7000-8000-00000000abcd",
    ]);
  });
});

describe("POST /public/tracking/collect — tenancy and validation", () => {
  it("refuses a signed body whose shop differs from the transport's resolved tenant (403)", async () => {
    const { app, published } = await boot();

    const res = await sendSigned(app, edgeBody(), { tenantHeader: "shop-other" });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "TENANT_MISMATCH" });
    expect(published).toEqual([]);
  });

  it("refuses an unknown field in the body (422) — the body is strict", async () => {
    const { app, published } = await boot();
    const res = await sendSigned(app, edgeBody({ writeKey: "wk_live_x" }));
    expect(res.statusCode).toBe(422);
    expect(published).toEqual([]);
  });

  it("refuses an event without an environment instead of guessing (422 ENVIRONMENT_UNKNOWN)", async () => {
    const { app, published } = await boot();
    const body = edgeBody();
    delete (body["event"] as Record<string, unknown>)["environment"];

    const res = await sendSigned(app, body);

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "ENVIRONMENT_UNKNOWN", retryable: false });
    expect(published).toEqual([]);
  });

  it("answers 413 for a body past 64 KB, before it is parsed as an event", async () => {
    const { app, published } = await boot();
    const body = edgeBody();
    (body["event"] as Record<string, unknown>)["properties"] = { pad: "x".repeat(70_000) };

    const res = await sendSigned(app, body);

    expect(res.statusCode).toBe(413);
    expect(published).toEqual([]);
  });
});

describe("POST /public/tracking/collect — transport failure", () => {
  it("answers a retryable 503 when the sink cannot accept the event — never a false 202", async () => {
    const { app } = await boot({ failPublish: true });

    const res = await sendSigned(app);

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "PUBLISH_FAILED", retryable: true });
    expect(JSON.stringify(res.json())).not.toContain("broker is down");
  });
});

describe("POST /public/tracking/collect — Cookie Keeper (P1-D6)", () => {
  const keeperSeen: { tenantId: string; visitorId: string; present: string[] }[] = [];
  const keeper: TrackingCookieKeeper = ({ tenantId, visitorId, present }) => {
    keeperSeen.push({ tenantId, visitorId, present: [...present].sort() });
    return Promise.resolve([{ name: "_ttp", value: "restored-ttp", maxAgeSeconds: 34_128_000 }]);
  };
  const withVisitor = (cookies: Record<string, string>): Record<string, unknown> => {
    const body = edgeBody();
    (body["client"] as { cookies: Record<string, string> }).cookies = {
      visitorId: "mb-visitor-0001-aaaa",
      ...cookies,
    };
    return body;
  };

  beforeEach(() => {
    keeperSeen.length = 0;
  });

  it("returns the keeper's cookies, asked for the SIGNED tenant and visitor with the names the browser holds", async () => {
    const { app } = await boot({ cookieKeeper: keeper });

    const res = await sendSigned(app, withVisitor({ fbp: "fb.1.1.1", ga: "GA1.1.1.2", epik: "e" }));

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      cookies: [{ name: "_ttp", value: "restored-ttp", maxAgeSeconds: 34_128_000 }],
    });
    expect(keeperSeen).toEqual([
      {
        tenantId: SHOP,
        visitorId: "mb-visitor-0001-aaaa",
        present: ["_fbp", "_ga", "_epik"].sort(),
      },
    ]);
  });

  it("lists no cookies — and does not ask — when the request has no visitor id", async () => {
    const { app } = await boot({ cookieKeeper: keeper });

    const res = await sendSigned(app);

    expect(res.json()).toMatchObject({ cookies: [] });
    expect(keeperSeen).toEqual([]);
  });

  it("a failing keeper never fails the capture: 202 with no cookies, event still queued", async () => {
    const { app, published } = await boot({
      cookieKeeper: () => Promise.reject(new Error("db down: secret-row-contents")),
    });

    const res = await sendSigned(app, withVisitor({}));

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ cookies: [] });
    expect(JSON.stringify(res.json())).not.toContain("secret-row-contents");
    expect(published).toHaveLength(1);
  });

  it("never asks the keeper for an unauthenticated or other-tenant request", async () => {
    const { app } = await boot({ cookieKeeper: keeper });

    const unsigned = await sendSigned(app, withVisitor({}), { signature: "0".repeat(64) });
    const other = await sendSigned(app, withVisitor({}), { tenantHeader: "shop-other" });

    expect(unsigned.statusCode).toBe(401);
    expect(other.statusCode).toBe(403);
    expect(keeperSeen).toEqual([]);
  });
});
