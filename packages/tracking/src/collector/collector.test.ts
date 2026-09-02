import { describe, expect, it } from "vitest";

import {
  collect,
  TRACKING_CAPTURED_TOPIC,
  type CollectorDeps,
  type CollectorRequest,
} from "./collector";
import {
  COLLECTOR_COOKIES,
  parseCookieHeader,
  resolveClientIp,
  resolveUserAgent,
} from "./client-context";

const AT = new Date("2026-07-19T12:00:00.000Z");
const TENANT = "tenant-collector";

function deps(overrides: Partial<CollectorDeps> = {}): CollectorDeps {
  let n = 0;
  return {
    writeKeys: {
      resolve: (key) => (key === "wk_live_ok" ? { tenantId: TENANT, storeId: "store-1" } : null),
    },
    idGenerator: { generate: () => `gen-${String((n += 1))}` },
    clock: { now: () => AT },
    ipPolicy: { trustedProxyCount: 0 },
    ...overrides,
  };
}

function request(overrides: Partial<CollectorRequest> = {}): CollectorRequest {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };
  return {
    body: {
      writeKey: "wk_live_ok",
      event: {
        eventName: "page_view",
        eventVersion: 1,
        timestamp: AT.toISOString(),
        environment: "production",
        consent: { analytics: true, marketing: true, personalization: true },
        context: { page: { url: "https://shop.example/landing?gclid=CJ-abc&utm_source=google" } },
        properties: {},
      },
    },
    headers: (name) => headers[name],
    cookies: () => undefined,
    remoteAddress: "203.0.113.7",
    ...overrides,
  };
}

/** Narrows to the accepted branch, failing loudly instead of silently skipping assertions. */
function accepted(outcome: ReturnType<typeof collect>) {
  if (outcome.status !== "accepted") {
    throw new Error(`expected acceptance, got refusal ${JSON.stringify(outcome.refusal)}`);
  }
  return outcome;
}

describe("Collector — parse, validate, resolve, publish once", () => {
  it("produces a publishable envelope from a browser beacon", () => {
    const out = accepted(collect(request(), deps()));

    expect(out.envelope.eventName).toBe("page_view");
    expect(out.envelope.eventOrigin).toBe("browser");
    expect(out.envelope.receivedAt).toBe(AT.toISOString());
    expect(out.envelope.tenancy?.tenantId).toBe(TENANT);
  });

  it("resolves the tenant from the write key and DISCARDS a body-supplied tenant", () => {
    // The endpoint is public. If a body-claimed tenant survived, any visitor could write events
    // into any merchant's account and every record would look well-formed forever.
    const spoofed = request();
    const body = spoofed.body as { event: Record<string, unknown> };
    body.event["tenancy"] = { tenantId: "tenant-victim", storeId: "store-victim" };

    const out = accepted(collect(spoofed, deps()));

    expect(out.envelope.tenancy?.tenantId).toBe(TENANT);
    expect(out.envelope.tenancy?.storeId).toBe("store-1");
  });

  it("refuses an unknown write key rather than falling back to a default tenant", () => {
    const out = collect(request({ body: { writeKey: "wk_nope", event: {} } }), deps());
    expect(out.status).toBe("refused");
    if (out.status === "refused") expect(out.refusal.code).toBe("write_key_unknown");
  });

  it("refuses an event with no environment instead of guessing", () => {
    const req = request();
    delete (req.body as { event: Record<string, unknown> }).event["environment"];

    const out = collect(req, deps());
    expect(out.status).toBe("refused");
    if (out.status === "refused") expect(out.refusal.code).toBe("environment_unknown");
  });

  it("fails consent closed when the block is absent", () => {
    const req = request();
    delete (req.body as { event: Record<string, unknown> }).event["consent"];

    const out = accepted(collect(req, deps()));
    expect(out.envelope.consent).toMatchObject({
      analytics: false,
      marketing: false,
      personalization: false,
    });
  });

  it("treats a non-boolean consent value as NOT granted", () => {
    const req = request();
    (req.body as { event: Record<string, unknown> }).event["consent"] = {
      analytics: "yes",
      marketing: 1,
      personalization: null,
    };

    const out = accepted(collect(req, deps()));
    expect(out.envelope.consent.analytics).toBe(false);
    expect(out.envelope.consent.marketing).toBe(false);
  });

  it("extracts click ids from the TRACKED PAGE url, not the collector's own request", () => {
    const out = accepted(collect(request(), deps()));
    const clickIds = out.envelope.context.attribution?.clickIds ?? [];

    expect(clickIds.map((c) => c.name)).toContain("gclid");
    expect(clickIds.find((c) => c.name === "gclid")?.value).toBe("CJ-abc");
  });

  it("derives Meta's _fbc from fbclid only when the pixel cookie is absent", () => {
    const withFbclid = request();
    (withFbclid.body as { event: { context: { page: { url: string } } } }).event.context.page.url =
      "https://shop.example/l?fbclid=IwAR123";

    const derived = accepted(collect(withFbclid, deps()));
    expect(derived.envelope.context.attribution?.meta?.fbc).toBe(
      `fb.1.${String(AT.getTime())}.IwAR123`,
    );

    // When the pixel already set `_fbc`, that value wins — it carries the real click timestamp,
    // whereas a derived one carries this request's time and can fall outside the click window.
    const jar = parseCookieHeader("_fbc=fb.1.1700000000000.REAL; _fbp=fb.1.1.2");
    const withCookie = accepted(collect({ ...withFbclid, cookies: jar }, deps()));
    expect(withCookie.envelope.context.attribution?.meta?.fbc).toBe("fb.1.1700000000000.REAL");
    expect(withCookie.envelope.context.attribution?.meta?.fbp).toBe("fb.1.1.2");
  });

  it("mints a visitor and session when no cookie exists, and asks the transport to set them", () => {
    const out = accepted(collect(request(), deps()));

    expect(out.envelope.context.session?.sessionId).toBeDefined();
    expect(out.envelope.context.session?.visitorId).toBeDefined();
    expect(out.cookies.map((c) => c.name)).toEqual([
      COLLECTOR_COOKIES.visitorId,
      COLLECTOR_COOKIES.sessionId,
    ]);
  });

  it("reuses existing cookies and still slides the session window forward", () => {
    const jar = parseCookieHeader(
      `${COLLECTOR_COOKIES.visitorId}=v-1; ${COLLECTOR_COOKIES.sessionId}=s-1`,
    );
    const out = accepted(collect(request({ cookies: jar }), deps()));

    expect(out.envelope.context.session?.visitorId).toBe("v-1");
    expect(out.envelope.context.session?.sessionId).toBe("s-1");
    // The visitor cookie is not re-sent (it was already correct); the session cookie IS, because
    // its max-age is what keeps an actively browsing visitor from expiring mid-session.
    expect(out.cookies.map((c) => c.name)).toEqual([COLLECTOR_COOKIES.sessionId]);
  });

  it("overwrites browser-claimed IP and user agent with server-observed values", () => {
    const req = request();
    (req.body as { event: { context: Record<string, unknown> } }).event.context["technical"] = {
      clientIpAddress: "1.2.3.4",
      clientUserAgent: "totally-a-real-browser",
    };

    const out = accepted(collect(req, deps()));
    expect(out.envelope.context.technical?.clientIpAddress).toBe("203.0.113.7");
    expect(out.envelope.context.technical?.clientUserAgent).toContain("Macintosh");
  });

  it("refuses a malformed body without throwing", () => {
    for (const body of [null, "string", 42, [], { writeKey: "wk_live_ok" }]) {
      const out = collect(request({ body }), deps());
      expect(out.status).toBe("refused");
    }
  });

  it("names the bridge topic exactly once, so collector and consumer cannot drift", () => {
    expect(TRACKING_CAPTURED_TOPIC).toBe("tracking.event.captured");
  });
});

describe("Client IP resolution is a security boundary", () => {
  const xff = (value: string, remote = "10.0.0.1") => ({
    headers: ((name: string) => (name === "x-forwarded-for" ? value : undefined)) as (
      n: string,
    ) => string | undefined,
    remote,
  });

  it("IGNORES X-Forwarded-For when no proxy is trusted", () => {
    // The header is client-settable. Trusting it with nothing in front of us would let any visitor
    // choose their own IP — and with it their geo, their match quality and their rate-limit bucket.
    const { headers, remote } = xff("8.8.8.8");
    expect(resolveClientIp(headers, remote, { trustedProxyCount: 0 })).toEqual({
      ip: "10.0.0.1",
      basis: "socket",
    });
  });

  it("counts trusted proxies from the RIGHT, so a spoofed prefix cannot win", () => {
    // A visitor sends `X-Forwarded-For: 6.6.6.6`; our one proxy appends the real peer. Taking the
    // left-most entry — the usual shortcut — would return the attacker's value.
    const { headers, remote } = xff("6.6.6.6, 203.0.113.9");
    expect(resolveClientIp(headers, remote, { trustedProxyCount: 1 })).toEqual({
      ip: "203.0.113.9",
      basis: "forwarded",
    });
  });

  it("falls back to the socket when the chain is shorter than the configured topology", () => {
    const { headers, remote } = xff("203.0.113.9");
    expect(resolveClientIp(headers, remote, { trustedProxyCount: 3 })).toEqual({
      ip: "10.0.0.1",
      basis: "socket",
    });
  });

  it("reports unavailable rather than inventing a placeholder", () => {
    expect(resolveClientIp(() => undefined, undefined, { trustedProxyCount: 0 })).toEqual({
      ip: undefined,
      basis: "unavailable",
    });
  });

  it("normalizes ports, brackets and IPv4-mapped IPv6", () => {
    const at = (remote: string) =>
      resolveClientIp(() => undefined, remote, { trustedProxyCount: 0 }).ip;
    expect(at("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(at("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(at("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(at("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("User agent classification stays shallow and honest", () => {
  const ua = (value: string) => resolveUserAgent((n) => (n === "user-agent" ? value : undefined));

  it("classifies an Android tablet as tablet, not mobile", () => {
    // "android" without "mobile" is a tablet. Checking mobile first — the common ordering bug —
    // silently reclassifies every Android tablet.
    expect(ua("Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit").deviceType).toBe("tablet");
    expect(ua("Mozilla/5.0 (Linux; Android 13; Pixel 7 Mobile) AppleWebKit").deviceType).toBe(
      "mobile",
    );
  });

  it("flags crawlers, because forwarding them degrades vendor match quality", () => {
    // Every real crawler token is a SUFFIX, so a leading word boundary matches none of them —
    // the first implementation used `\bbot\b` and classified Googlebot as a desktop browser.
    expect(ua("Mozilla/5.0 (compatible; Googlebot/2.1)").deviceType).toBe("bot");
    expect(ua("Mozilla/5.0 (compatible; bingbot/2.0)").deviceType).toBe("bot");
    expect(ua("Mozilla/5.0 (compatible; AhrefsBot/7.0)").deviceType).toBe("bot");
    expect(ua("HeadlessChrome/120.0").deviceType).toBe("bot");
  });

  it("does not mistake a device name containing 'bot' for a crawler", () => {
    // Cubot is a phone brand. The trailing boundary is what separates it from `Googlebot/`.
    expect(ua("Mozilla/5.0 (Linux; Android 11; Cubot_X30 Mobile)").deviceType).toBe("mobile");
  });

  it("treats an absent user agent as unknown rather than as a bot", () => {
    // Calling it a bot would reclassify privacy-tool users as crawlers and quietly drop real people.
    expect(ua("").deviceType).toBe("unknown");
    expect(resolveUserAgent(() => undefined)).toEqual({
      clientUserAgent: undefined,
      deviceType: "unknown",
    });
  });

  it("carries the raw user agent verbatim — it is what conversions APIs require", () => {
    const raw = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
    expect(ua(raw).clientUserAgent).toBe(raw);
  });
});
