// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type * as RuntimeApi from "@/lib/runtime-api";

const createLead = vi.fn();
vi.mock("@/lib/runtime-api", async () => {
  // The real guards: the action must use them, not re-implement the contract.
  const real = await vi.importActual<typeof RuntimeApi>("@/lib/runtime-api");
  return {
    isCreateLeadResult: real.isCreateLeadResult,
    validationFieldsOf: real.validationFieldsOf,
    createLead: (...args: unknown[]) => createLead(...args),
  };
});

interface JarEntry {
  value: string;
  expiresAt: number;
}
/** A browser: cookies with a lifetime on a fake clock. */
let jar = new Map<string, JarEntry>();
let now = 0;
let requestHeaders = new Map<string, string>();
const setCalls: { name: string; value: string; options: Record<string, unknown> }[] = [];

function live(name: string): string | undefined {
  const entry = jar.get(name);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= now) {
    jar.delete(name);
    return undefined;
  }
  return entry.value;
}
function store(name: string, value: string, options: { maxAge?: number }): void {
  if (options.maxAge === 0 || value === "") jar.delete(name);
  else jar.set(name, { value, expiresAt: now + (options.maxAge ?? 31_536_000) * 1000 });
}

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = live(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        setCalls.push({ name, value, options });
        store(name, value, options);
      },
    }),
  headers: () => Promise.resolve({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));

const { submitLead } = await import("./lead-actions");
const { withVisitorSession, LEAD_SENT_COOKIE, VISITOR_SESSION_COOKIE } =
  await import("@/lib/visitor-session");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = "submit-key-0001";
const input = {
  formId: "section-1",
  name: "Mona",
  phone: "01001234567",
  email: "mona@example.com",
  message: "Call me",
  honeypot: "",
  elapsedMs: 8_123.4,
  submissionKey: KEY,
};
const created = (emission: "emit" | "suppressed" | "spam") => ({
  status: 201,
  body: { leadId: "lead-1", eventId: "lead_lead-1", emission },
});
const envelope = (fields: { field: string; message: string }[]) => ({
  code: "VALIDATION",
  message: "Invalid request body",
  retryable: false,
  fields,
});
const sentBody = () => (createLead.mock.calls.at(-1) as [Record<string, unknown>, string])[0];
const setOf = (name: string) => setCalls.filter((c) => c.name === name);

/** What the middleware does on every response: runs on the cookies the browser would send. */
function visit(): void {
  const cookie = [VISITOR_SESSION_COOKIE, LEAD_SENT_COOKIE]
    .flatMap((name) => {
      const value = live(name);
      return value === undefined ? [] : [`${name}=${value}`];
    })
    .join("; ");
  const request = new NextRequest("https://shop.example/", {
    headers: cookie === "" ? {} : { cookie },
  });
  const response = withVisitorSession(request, NextResponse.next());
  for (const c of response.cookies.getAll()) store(c.name, c.value, { maxAge: c.maxAge });
}

beforeEach(() => {
  expect.hasAssertions();
  jar = new Map();
  now = 0;
  requestHeaders = new Map();
  setCalls.length = 0;
  createLead.mockReset();
  createLead.mockResolvedValue(created("emit"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submitLead request", () => {
  it("sends exactly the route body for the given cookies and headers", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("_fbp", { value: "fb.1.123.456", expiresAt: 1e12 });
    jar.set("_fbc", { value: "fb.1.123.click", expiresAt: 1e12 });
    jar.set("_ttp", { value: "ttp-1", expiresAt: 1e12 });
    jar.set("_scid", { value: "scid-1", expiresAt: 1e12 });
    jar.set("_ga", { value: "GA1.1.1.2", expiresAt: 1e12 });
    requestHeaders.set("referer", "https://shop.example/?utm_source=ad");
    requestHeaders.set("x-forwarded-for", "203.0.113.7");
    requestHeaders.set("user-agent", "Mozilla/5.0 Test");

    const result = await submitLead(input);

    expect(result).toEqual({ ok: true });
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(createLead).toHaveBeenCalledWith(
      {
        formId: "section-1",
        name: "Mona",
        phone: "01001234567",
        email: "mona@example.com",
        message: "Call me",
        sessionId: "sid-1",
        sessionAlreadyEmitted: false,
        spamSignals: { honeypot: false, elapsedMs: 8123 },
        context: {
          pageUrl: "https://shop.example/?utm_source=ad",
          referrer: null,
          ip: "203.0.113.7",
          userAgent: "Mozilla/5.0 Test",
          cookies: {
            fbp: "fb.1.123.456",
            fbc: "fb.1.123.click",
            ttp: "ttp-1",
            scid: "scid-1",
            ga: "GA1.1.1.2",
          },
          // P2-D8: the referer carries a utm label; the visitor id and click ids are absent from this jar
          utm: { source: "ad" },
        },
      },
      KEY,
    );
  });

  it("forwards the visitor id, the click jar and the page's UTM labels from the server-side jar (P2-D8)", async () => {
    const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("_mb_id", { value: VISITOR, expiresAt: 1e12 });
    jar.set("_mb_clk", {
      value: JSON.stringify({ gclid: { v: "Cj0KCQ-abc", t: Date.now() - 2 * 86_400_000 } }),
      expiresAt: 1e12,
    });
    requestHeaders.set("referer", "https://shop.example/?utm_source=ad&utm_campaign=eid");

    await submitLead(input);

    const context = sentBody().context as Record<string, unknown>;
    expect(context["visitorId"]).toBe(VISITOR);
    expect(context["clickIds"]).toEqual([
      { name: "gclid", value: "Cj0KCQ-abc", capturedAt: expect.any(String) as string },
    ]);
    expect(context["utm"]).toEqual({ source: "ad", campaign: "eid" });
  });

  it("leaves a malformed _mb_id and a stale click out, and the old keys unchanged", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("_mb_id", { value: "nope", expiresAt: 1e12 });
    jar.set("_mb_clk", {
      value: JSON.stringify({ scclid: { v: "stale", t: Date.now() - 60 * 86_400_000 } }),
      expiresAt: 1e12,
    });

    await submitLead(input);

    const context = sentBody().context as Record<string, unknown>;
    expect(context).not.toHaveProperty("visitorId");
    expect(context).not.toHaveProperty("clickIds");
    expect(context).not.toHaveProperty("utm");
  });

  it("takes nothing about the visitor from the form input", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead({
      ...input,
      visitorId: "evil-visitor-id-0000",
      clickIds: [{ name: "gclid", value: "evil", capturedAt: new Date().toISOString() }],
    } as typeof input);
    expect(JSON.stringify(sentBody())).not.toContain("evil");
  });

  it("uses the submission key as the Idempotency-Key and mints nothing itself", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead({ ...input, submissionKey: "another-key-77" });
    expect((createLead.mock.calls[0] as unknown[])[1]).toBe("another-key-77");
  });

  it("sends nulls and no cookies when the request carries nothing", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead({ ...input, email: undefined, message: undefined });

    const body = sentBody();
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("message");
    expect(body.context).toEqual({
      pageUrl: null,
      referrer: null,
      ip: null,
      userAgent: null,
      cookies: {},
    });
  });

  it("drops empty optional fields and trims the text fields", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead({ ...input, name: "  Mona ", phone: " 0100 ", email: "  ", message: "\n" });

    const body = sentBody();
    expect(body).toMatchObject({ name: "Mona", phone: "0100" });
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("message");
  });

  it("bounds what the route would refuse: long agent, referer, address and cookie values", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("_fbp", { value: "f".repeat(513), expiresAt: 1e12 });
    jar.set("_ga", { value: "g".repeat(512), expiresAt: 1e12 });
    requestHeaders.set("user-agent", "u".repeat(900));
    requestHeaders.set("referer", `https://shop.example/${"r".repeat(3000)}`);
    requestHeaders.set("x-forwarded-for", "9".repeat(65));

    await submitLead(input);

    const context = sentBody().context as {
      userAgent: string;
      pageUrl: string;
      ip: string | null;
      cookies: Record<string, string>;
    };
    expect(context.userAgent).toHaveLength(512);
    expect(context.pageUrl).toHaveLength(2048);
    expect(context.ip).toBeNull();
    expect(context.cookies).toEqual({ ga: "g".repeat(512) });
  });

  it("takes the address the edge appended, never a left-most value the submitter wrote (P1-D7)", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    requestHeaders.set("x-forwarded-for", "1.2.3.4, 10.9.8.7, 203.0.113.7");

    await submitLead(input);

    expect((sentBody().context as { ip: string | null }).ip).toBe("203.0.113.7");
  });

  it("honours STOREFRONT_TRUSTED_PROXIES for a deployment with a second proxy in front", async () => {
    vi.stubEnv("STOREFRONT_TRUSTED_PROXIES", "2");
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    requestHeaders.set("x-forwarded-for", "1.2.3.4, 203.0.113.7, 104.16.0.1");

    await submitLead(input);

    expect((sentBody().context as { ip: string | null }).ip).toBe("203.0.113.7");
  });

  it("sends no address at all when no proxy is trusted (the header is then the submitter's)", async () => {
    vi.stubEnv("STOREFRONT_TRUSTED_PROXIES", "0");
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    requestHeaders.set("x-forwarded-for", "203.0.113.7");

    await submitLead(input);

    expect((sentBody().context as { ip: string | null }).ip).toBeNull();
  });

  it("flags a filled honeypot and clamps a bad elapsed time", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead({ ...input, honeypot: " x ", elapsedMs: -50 });
    expect(sentBody().spamSignals).toEqual({ honeypot: true, elapsedMs: 0 });

    await submitLead({ ...input, elapsedMs: Number.NaN });
    expect(sentBody().spamSignals).toEqual({ honeypot: false, elapsedMs: 0 });

    await submitLead({ ...input, elapsedMs: Number.POSITIVE_INFINITY });
    expect(sentBody().spamSignals).toEqual({ honeypot: false, elapsedMs: Number.MAX_SAFE_INTEGER });
  });
});

describe("submitLead session", () => {
  it("reports sessionAlreadyEmitted when the marker equals the session", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("morbeh_lead_sent", { value: "sid-1", expiresAt: 1e12 });
    await submitLead(input);
    expect(sentBody().sessionAlreadyEmitted).toBe(true);
  });

  it("reports false when the marker names another session", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    jar.set("morbeh_lead_sent", { value: "sid-0", expiresAt: 1e12 });
    await submitLead(input);
    expect(sentBody().sessionAlreadyEmitted).toBe(false);
  });

  it.each([[undefined], ["bad id!"]])(
    "mints and sets a session id when the cookie is %s",
    async (cookie) => {
      if (cookie !== undefined) jar.set("morbeh_sid", { value: cookie, expiresAt: 1e12 });
      jar.set("morbeh_lead_sent", { value: String(cookie), expiresAt: 1e12 });

      await submitLead(input);

      const minted = sentBody().sessionId as string;
      expect(minted).toMatch(UUID);
      expect(sentBody().sessionAlreadyEmitted).toBe(false);
      expect(setOf("morbeh_sid")).toEqual([
        {
          name: "morbeh_sid",
          value: minted,
          options: {
            path: "/",
            maxAge: 1800,
            sameSite: "lax",
            secure: false,
            httpOnly: false,
          },
        },
      ]);
    },
  );

  it("does not touch the session cookie when it is valid", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    await submitLead(input);
    expect(setOf("morbeh_sid")).toEqual([]);
  });
});

describe("submitLead outcome", () => {
  it("201 emit sets the sent marker: HttpOnly, 30 minutes, for this session", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue(created("emit"));

    expect(await submitLead(input)).toEqual({ ok: true });
    expect(setOf("morbeh_lead_sent")).toEqual([
      {
        name: "morbeh_lead_sent",
        value: "sid-1",
        options: { path: "/", maxAge: 1800, sameSite: "lax", secure: false, httpOnly: true },
      },
    ]);
  });

  it("201 suppressed also sets the marker (it slides the same session)", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue(created("suppressed"));
    expect(await submitLead(input)).toEqual({ ok: true });
    expect(setOf("morbeh_lead_sent")).toHaveLength(1);
  });

  it("201 spam sets nothing and still reports success", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue(created("spam"));

    expect(await submitLead(input)).toEqual({ ok: true });
    expect(setOf("morbeh_lead_sent")).toEqual([]);
  });

  it.each([
    ["no body", { status: 201, body: null }],
    ["a body that is not an object", { status: 201, body: "ok" }],
    ["no leadId", { status: 201, body: { eventId: "e", emission: "emit" } }],
    ["an unknown emission", { status: 201, body: { leadId: "l", eventId: "e", emission: "sent" } }],
    ["a numeric leadId", { status: 201, body: { leadId: 1, eventId: "e", emission: "emit" } }],
  ])("a 201 with %s is a network failure and sets no marker", async (_name, answer) => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue(answer);

    expect(await submitLead(input)).toEqual({ ok: false, reason: "network" });
    expect(setOf("morbeh_lead_sent")).toEqual([]);
  });

  it("422 with phone and email maps to those fields, in order", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue({
      status: 422,
      body: envelope([
        { field: "phone", message: "is not a valid phone number" },
        { field: "email", message: "is not a valid email" },
      ]),
    });

    expect(await submitLead(input)).toEqual({
      ok: false,
      reason: "validation",
      fields: ["phone", "email"],
    });
    expect(setOf("morbeh_lead_sent")).toEqual([]);
  });

  it("422 keeps only the four form fields and ignores a malformed envelope", async () => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValueOnce({
      status: 422,
      body: envelope([
        { field: "name", message: "required" },
        { field: "Idempotency-Key", message: "bad" },
        { field: "context.ip", message: "bad" },
      ]),
    });
    expect(await submitLead(input)).toEqual({ ok: false, reason: "validation", fields: ["name"] });

    createLead.mockResolvedValueOnce({ status: 422, body: null });
    expect(await submitLead(input)).toEqual({ ok: false, reason: "validation", fields: [] });

    createLead.mockResolvedValueOnce({ status: 422, body: { fields: "phone" } });
    expect(await submitLead(input)).toEqual({ ok: false, reason: "validation", fields: [] });
  });

  it.each([
    [429, { ok: false, reason: "rate_limited" }],
    [409, { ok: false, reason: "unavailable" }],
    [503, { ok: false, reason: "unavailable" }],
    [500, { ok: false, reason: "network" }],
    [400, { ok: false, reason: "network" }],
    [200, { ok: false, reason: "network" }],
    [0, { ok: false, reason: "network" }],
  ])("status %i maps to %j", async (status, expected) => {
    jar.set("morbeh_sid", { value: "sid-1", expiresAt: 1e12 });
    createLead.mockResolvedValue({ status, body: null });

    expect(await submitLead(input)).toEqual(expected);
    expect(setOf("morbeh_lead_sent")).toEqual([]);
  });
});

describe("the sent marker across a long session (cookie jar and clock)", () => {
  const MINUTE = 60_000;

  it("activity every 25 minutes for 25 hours keeps the marker", async () => {
    visit();
    await submitLead(input);
    expect(live("morbeh_lead_sent")).toBe(live("morbeh_sid"));

    for (let elapsed = 25; elapsed <= 25 * 60; elapsed += 25) {
      now += 25 * MINUTE;
      visit();
    }
    expect(now).toBe(25 * 60 * MINUTE);

    createLead.mockClear();
    await submitLead(input);
    expect(sentBody().sessionAlreadyEmitted).toBe(true);
    expect(sentBody().sessionId).toBe(live("morbeh_sid"));
  });

  it("31 idle minutes starts a new session and the marker is gone", async () => {
    visit();
    const first = live("morbeh_sid");
    await submitLead(input);

    now += 31 * MINUTE;
    visit();

    expect(live("morbeh_sid")).not.toBe(first);
    expect(live("morbeh_lead_sent")).toBeUndefined();
    createLead.mockClear();
    await submitLead(input);
    expect(sentBody().sessionAlreadyEmitted).toBe(false);
  });

  it("a marker left over from another session is removed on the next page", async () => {
    visit();
    jar.set("morbeh_lead_sent", { value: "old-session", expiresAt: now + 1_000_000 });
    visit();
    expect(live("morbeh_lead_sent")).toBeUndefined();
  });
});
