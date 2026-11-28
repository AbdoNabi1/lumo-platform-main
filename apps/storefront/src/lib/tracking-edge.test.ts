import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  COLLECT_PATH,
  sendTrackingEvent,
  signTrackingRequest,
  trackingEdgeSecret,
  type SendTrackingEventInput,
} from "./tracking-edge";

/** Low-entropy test values on purpose (secret scanners): not credentials. */
const SECRET = "edge-secret-for-tests-".padEnd(40, "0");
const NOW_MS = Date.parse("2026-11-27T12:00:00.000Z");
const NOW_S = Math.floor(NOW_MS / 1000);

const INPUT: SendTrackingEventInput = {
  tenantId: "shop-1",
  event: { eventName: "page_view", environment: "production" },
  client: {
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    pageUrl: "https://shop.example/?gclid=CJ-abc",
    referrer: null,
    cookies: { fbp: "fb.1.1764000000.1234567890" },
  },
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status });

describe("trackingEdgeSecret", () => {
  it("is null when absent or shorter than 32 bytes, and the value otherwise", () => {
    expect(trackingEdgeSecret({})).toBeNull();
    expect(trackingEdgeSecret({ TRACKING_EDGE_SECRET: "short" })).toBeNull();
    expect(trackingEdgeSecret({ TRACKING_EDGE_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("signTrackingRequest", () => {
  it("signs `<seconds>.<exact body>` with HMAC-SHA256 as lowercase hex (the runtime verifies the same bytes)", async () => {
    const body = '{"tenantId":"shop-1","event":{"eventName":"page_view"}}';

    const headers = await signTrackingRequest(SECRET, body, NOW_MS);

    expect(headers["x-mb-ts"]).toBe(String(NOW_S));
    expect(headers["x-mb-sig"]).toBe(
      createHmac("sha256", SECRET).update(`${NOW_S}.${body}`).digest("hex"),
    );
    expect(headers["x-mb-sig"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the body, the secret and the second", async () => {
    const sig = async (secret: string, body: string, at: number) =>
      (await signTrackingRequest(secret, body, at))["x-mb-sig"];
    const base = await sig(SECRET, "a", NOW_MS);
    expect(await sig(SECRET, "b", NOW_MS)).not.toBe(base);
    expect(await sig("other-".padEnd(40, "1"), "a", NOW_MS)).not.toBe(base);
    expect(await sig(SECRET, "a", NOW_MS + 1000)).not.toBe(base);
    // …but not with the millisecond: the timestamp is whole seconds.
    expect(await sig(SECRET, "a", NOW_MS + 999)).toBe(base);
  });

  it("signs a multi-byte body exactly like node:crypto does over its UTF-8 bytes", async () => {
    const body = JSON.stringify({ name: "مُنتج — ✓", note: "naïve" });

    const headers = await signTrackingRequest(SECRET, body, NOW_MS);

    expect(headers["x-mb-sig"]).toBe(
      createHmac("sha256", SECRET).update(`${NOW_S}.`).update(body).digest("hex"),
    );
  });
});

describe("sendTrackingEvent", () => {
  it("sends nothing and does not throw when the secret is not configured (fail safe)", async () => {
    const fetchImpl = vi.fn();

    const result = await sendTrackingEvent(INPUT, { env: {}, fetchImpl });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the signed bytes to the collect route with the shop in x-tenant-id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ eventId: "evt-1", cookies: [] }, 202));

    const result = await sendTrackingEvent(INPUT, {
      env: { TRACKING_EDGE_SECRET: SECRET },
      fetchImpl,
      nowMs: () => NOW_MS,
      runtimeUrl: "https://runtime.example",
    });

    expect(result).toEqual({ ok: true, eventId: "evt-1", cookies: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://runtime.example${COLLECT_PATH}`);
    expect(COLLECT_PATH).toBe("/api/v1/public/tracking/collect");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("shop-1");
    expect(headers["content-type"]).toBe("application/json");
    // The signature covers exactly the bytes in the request body.
    const sent = init.body as string;
    expect(JSON.parse(sent)).toEqual({
      tenantId: "shop-1",
      event: INPUT.event,
      client: INPUT.client,
    });
    expect(headers["x-mb-ts"]).toBe(String(NOW_S));
    expect(headers["x-mb-sig"]).toBe(
      createHmac("sha256", SECRET).update(`${NOW_S}.${sent}`).digest("hex"),
    );
  });

  it("hands back the cookies the runtime asks to re-emit, dropping malformed entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(
        {
          eventId: "evt-2",
          cookies: [{ name: "_fbp", value: "fb.1.1.2", maxAgeSeconds: 100 }, { name: 1 }, "x"],
        },
        202,
      ),
    );

    const result = await sendTrackingEvent(INPUT, {
      env: { TRACKING_EDGE_SECRET: SECRET },
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      eventId: "evt-2",
      cookies: [{ name: "_fbp", value: "fb.1.1.2", maxAgeSeconds: 100 }],
    });
  });

  it("maps the runtime's NOT_CONFIGURED 503 to not_configured, other 5xx/429 to unavailable, 4xx to rejected", async () => {
    const env = { TRACKING_EDGE_SECRET: SECRET };
    const answer = async (response: Response) =>
      sendTrackingEvent(INPUT, { env, fetchImpl: vi.fn().mockResolvedValue(response) });

    expect(await answer(json({ code: "NOT_CONFIGURED" }, 503))).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(await answer(json({ code: "PUBLISH_FAILED" }, 503))).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await answer(json({}, 429))).toEqual({ ok: false, reason: "unavailable" });
    expect(await answer(json({ code: "UNAUTHORIZED" }, 401))).toEqual({
      ok: false,
      reason: "rejected",
    });
    expect(await answer(json({ code: "ENVIRONMENT_UNKNOWN" }, 422))).toEqual({
      ok: false,
      reason: "rejected",
    });
  });

  it("never throws on a network fault or an unreadable answer", async () => {
    const env = { TRACKING_EDGE_SECRET: SECRET };

    expect(
      await sendTrackingEvent(INPUT, {
        env,
        fetchImpl: vi.fn().mockRejectedValue(new Error("down")),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await sendTrackingEvent(INPUT, {
        env,
        fetchImpl: vi.fn().mockResolvedValue(new Response("<html>", { status: 202 })),
      }),
    ).toEqual({ ok: false, reason: "rejected" });
  });
});
