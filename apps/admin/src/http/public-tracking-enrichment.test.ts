import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  BlockedIpService,
  InMemoryBlockedIpStore,
  createCollectEnricher,
} from "@platform/tracking";
import {
  EDGE_SECRET,
  SHOP,
  buildEdgeApp,
  edgeBody,
  sendSigned,
  type EdgeApp,
  type EdgeAppOptions,
  type PublishedRecord,
} from "./testing/tracking-edge-harness";

/**
 * Tracking P1-D8 / D9 at the collect route: what is stamped on the queued event (user agent facts, geo, bot score,
 * AI source, cookieless id) and which requests are dropped by the store's own excluded-address list.
 */

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

interface Stamped {
  technical: Record<string, unknown>;
  attribution?: { aiSource?: string };
}

/** The `context` of the integration event the sink received, decoded from its bytes. */
function contextOf(record: PublishedRecord | undefined): Stamped {
  expect(record).toBeDefined();
  const event = JSON.parse(new TextDecoder().decode(record!.value)) as {
    payload: { envelope: { context: Stamped } };
  };
  return event.payload.envelope.context;
}

const hmac = (key: string, data: string): string =>
  createHmac("sha256", key).update(data).digest("hex");

const CHROME =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";

function withClient(
  client: Record<string, unknown>,
  event: Record<string, unknown> = {},
): Record<string, unknown> {
  const body = edgeBody();
  body["client"] = { ...(body["client"] as object), ...client };
  body["event"] = { ...(body["event"] as object), ...event };
  return body;
}

describe("POST /public/tracking/collect — collect-time enrichment (P1-D8)", () => {
  const enricher = createCollectEnricher({
    secret: EDGE_SECRET,
    hmacSha256Hex: hmac,
    geo: { lookup: (ip) => (ip === "41.32.7.9" ? { country: "EG", city: "Cairo" } : null) },
  });

  it("stamps user agent facts, geo, bot score and the cookieless id on the queued event", async () => {
    const { app, published } = await boot({ enricher });

    const res = await sendSigned(
      app,
      withClient({
        ip: "41.32.7.9",
        userAgent: CHROME,
        acceptLanguage: "ar-EG,ar;q=0.9",
        secChUa: '"Chromium";v="124"',
        host: "shop.example",
      }),
    );

    expect(res.statusCode).toBe(202);
    const { technical } = contextOf(published[0]);
    expect(technical).toMatchObject({
      browserName: "Chrome",
      osName: "Android",
      deviceType: "mobile",
      deviceBrand: "Samsung",
      countryDetected: "EG",
      cityDetected: "Cairo",
      botScore: 0,
      browserLanguage: "ar-EG",
      clientIpAddress: "41.32.7.9",
      clientUserAgent: CHROME,
    });
    expect(technical["fingerprintId"]).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("scores a crawler over the skip threshold but still queues the event (it is skipped later, and logged)", async () => {
    const { app, published } = await boot({ enricher });

    const res = await sendSigned(
      app,
      withClient({
        userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      }),
    );

    expect(res.statusCode).toBe(202);
    expect(published).toHaveLength(1);
    const { technical } = contextOf(published[0]);
    expect(technical["botScore"]).toBeGreaterThanOrEqual(50);
    expect(technical["botReasons"]).toContain("declared_crawler");
  });

  it("names an AI assistant referrer", async () => {
    const { app, published } = await boot({ enricher });

    await sendSigned(
      app,
      withClient({ referrer: "https://chatgpt.com/", pageUrl: "https://shop.example/p/1" }),
    );

    expect(contextOf(published[0]).attribution?.aiSource).toBe("chatgpt");
  });

  it("an older storefront that forwards no headers is not read as 'every visitor lacks Accept-Language'", async () => {
    const { app, published } = await boot({ enricher });

    await sendSigned(app, withClient({ userAgent: CHROME }));

    expect(contextOf(published[0]).technical["botScore"]).toBe(0);
  });

  it("a failing enricher costs the enrichment, never the event", async () => {
    const { app, published } = await boot({
      enricher: () => Promise.reject(new Error("redis down")),
    });

    const res = await sendSigned(app);

    expect(res.statusCode).toBe(202);
    expect(published).toHaveLength(1);
    expect(contextOf(published[0]).technical["botScore"]).toBeUndefined();
  });

  it("without an enricher the event goes out exactly as before", async () => {
    const { app, published } = await boot();

    await sendSigned(app);

    expect(contextOf(published[0]).technical["botScore"]).toBeUndefined();
  });
});

describe("POST /public/tracking/collect — excluded IP addresses (P1-D9)", () => {
  async function listWith(...cidrs: string[]): Promise<BlockedIpService> {
    let tick = 0;
    const service = new BlockedIpService({
      store: new InMemoryBlockedIpStore(),
      clock: { now: () => new Date("2026-11-28T10:00:00.000Z") },
      idGenerator: {
        generate: () => {
          tick += 1;
          return `id-${String(tick)}`;
        },
      },
      cacheTtlMs: 0,
    });
    for (const cidr of cidrs) await service.add(SHOP, { cidr });
    return service;
  }
  const withEvent = (event: Record<string, unknown>, ip = "203.0.113.7") =>
    withClient({ ip }, event);

  it("accepts (202) and drops an ordinary event from a listed address; the storefront is told why", async () => {
    const { app, published } = await boot({ blocklist: await listWith("203.0.113.7") });

    const res = await sendSigned(app);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ skipped: "blocked_ip", cookies: [] });
    expect(published).toEqual([]);
  });

  it("an unlisted address, and the neighbours of a listed single host on a shared carrier range, are collected (CGNAT)", async () => {
    const { app, published } = await boot({ blocklist: await listWith("41.32.7.9") });

    for (const ip of ["41.32.7.8", "41.32.7.10", "203.0.113.7"]) {
      expect((await sendSigned(app, withEvent({}, ip))).statusCode).toBe(202);
    }

    expect(published).toHaveLength(3);
  });

  it("a real order or lead is never dropped, whatever the address", async () => {
    const { app, published } = await boot({ blocklist: await listWith("203.0.113.0/24") });

    const purchase = await sendSigned(
      app,
      withEvent({ eventName: "purchase", payload: { orderId: "o-1" }, eventId: "order_o-1" }),
    );
    const lead = await sendSigned(
      app,
      withEvent({ eventName: "form_submitted", eventId: "lead_0192f0aa" }),
    );
    const viaOrderId = await sendSigned(
      app,
      withEvent({ eventName: "custom_event", payload: { orderId: "o-2" }, eventId: "evt-o-2" }),
    );

    for (const res of [purchase, lead, viaOrderId]) {
      expect(res.statusCode).toBe(202);
      expect(res.json()).not.toHaveProperty("skipped");
    }
    expect(published).toHaveLength(3);
  });

  it("is per store: the list of another shop never blocks this one", async () => {
    const service = new BlockedIpService({
      store: new InMemoryBlockedIpStore(),
      clock: { now: () => new Date() },
      idGenerator: { generate: () => "id-1" },
      cacheTtlMs: 0,
    });
    await service.add("shop-other", { cidr: "203.0.113.7" });
    const { app, published } = await boot({ blocklist: service });

    expect((await sendSigned(app)).statusCode).toBe(202);

    expect(published).toHaveLength(1);
  });

  it("fails open: an unreadable list blocks nothing", async () => {
    const { app, published } = await boot({
      blocklist: { isBlocked: () => Promise.reject(new Error("db down")) },
    });

    expect((await sendSigned(app)).statusCode).toBe(202);

    expect(published).toHaveLength(1);
  });

  it("a request with no address is never blocked", async () => {
    const { app, published } = await boot({ blocklist: await listWith("203.0.113.7") });
    const body = edgeBody();
    (body["client"] as Record<string, unknown>)["ip"] = null;

    expect((await sendSigned(app, body)).statusCode).toBe(202);

    expect(published).toHaveLength(1);
  });
});
