import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RateLimiter } from "@platform/contracts";
import type { WiredAdmin } from "../composition";
import { publicLeadsRoutes } from "./public-leads-routes";
import {
  buildLeadsApp,
  countingLimiter,
  freshKey,
  headersFor,
  leadBody,
  submitLead,
  type LeadsApp,
} from "./testing/leads-harness";

beforeEach(() => {
  expect.hasAssertions();
});

const apps: FastifyInstance[] = [];
async function boot(options: Parameters<typeof buildLeadsApp>[0] = {}): Promise<LeadsApp> {
  const built = await buildLeadsApp(options);
  apps.push(built.app);
  return built;
}
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

/** How many leads shop `t-1` holds, read through the operator's inbox. */
async function leadCount(app: FastifyInstance, tenantId = "t-1"): Promise<number> {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/leads?first=100",
    headers: headersFor("operator", { "x-tenant-id": tenantId }),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: unknown[] }).items.length;
}

describe("POST /public/leads — submission", () => {
  it("a lead site takes the lead (201 emit), then the same session's next lead is suppressed", async () => {
    const { app, claims } = await boot();
    const first = await submitLead(app);
    expect(first.statusCode).toBe(201);
    const body = first.json() as { leadId: string; eventId: string; emission: string };
    expect(body.emission).toBe("emit");
    expect(body.eventId).toBe(`lead_${body.leadId}`);

    const second = await submitLead(app, leadBody({ name: "Second Visitor" }));
    expect(second.statusCode).toBe(201);
    expect((second.json() as { emission: string }).emission).toBe("suppressed");
    expect(await leadCount(app)).toBe(2);
    expect(claims).toEqual(["lead-emit:t-1:session-0001", "lead-emit:t-1:session-0001"]);
  });

  it("a new session id is a new claim (emit again)", async () => {
    const { app } = await boot();
    await submitLead(app);
    const other = await submitLead(app, leadBody({ sessionId: "session-0002" }));
    expect((other.json() as { emission: string }).emission).toBe("emit");
  });

  it("a store shop refuses the lead: 409 BUSINESS_RULE, nothing stored or claimed", async () => {
    const { app, claims } = await boot({ siteType: "store" });
    const res = await submitLead(app);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("BUSINESS_RULE");
    expect(claims).toEqual([]);
    expect(await leadCount(app)).toBe(0);
  });

  it("a honeypot submission is saved as spam, answers success and claims nothing", async () => {
    const { app, claims } = await boot();
    const res = await submitLead(
      app,
      leadBody({ spamSignals: { honeypot: true, elapsedMs: 9_000 } }),
    );
    expect(res.statusCode).toBe(201);
    expect((res.json() as { emission: string }).emission).toBe("spam");
    expect(claims).toEqual([]);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/leads",
      headers: headersFor("operator"),
    });
    expect((list.json() as { items: { status: string; trackingStatus: string }[] }).items).toEqual([
      expect.objectContaining({ status: "spam", trackingStatus: "skipped_spam" }),
    ]);
  });

  it("a body naming a tenantId is refused 422 VALIDATION", async () => {
    const { app } = await boot();
    const res = await submitLead(app, leadBody({ tenantId: "t-2" }));
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("VALIDATION");
  });

  it("a body without sessionId is refused 422", async () => {
    const { app } = await boot();
    const body = leadBody();
    delete body.sessionId;
    const res = await submitLead(app, body);
    expect(res.statusCode).toBe(422);
  });

  it("an unparseable phone is 422 on the phone field", async () => {
    const { app } = await boot();
    const res = await submitLead(app, leadBody({ phone: "not a phone" }));
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify((res.json() as { fields: unknown }).fields)).toContain("phone");
  });
});

describe("POST /public/leads — Idempotency-Key", () => {
  it.each([
    ["missing", null],
    ["too short", "short"],
    ["bad characters", "has spaces in it!"],
  ])(
    "%s key → 422 VALIDATION on the Idempotency-Key field; nothing consumed or stored",
    async (_label, key) => {
      const limiter = countingLimiter();
      const { app } = await boot({ rateLimiter: limiter });
      const before = limiter.keys.length;
      const res = await submitLead(app, leadBody(), { key });
      expect(res.statusCode).toBe(422);
      const json = res.json() as { code: string; fields: { field: string }[] };
      expect(json.code).toBe("VALIDATION");
      expect(json.fields.map((f) => f.field)).toContain("Idempotency-Key");
      // only the transport's own bucket was consumed: no leads bucket
      expect(limiter.keys.slice(before).filter((k) => k.includes(":leads"))).toEqual([]);
      expect(await leadCount(app)).toBe(0);
    },
  );

  it("the same key twice → identical 201 bodies and ONE stored lead, one claim", async () => {
    const { app, claims } = await boot();
    const key = freshKey();
    const first = await submitLead(app, leadBody(), { key });
    const second = await submitLead(app, leadBody(), { key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await leadCount(app)).toBe(1);
    expect(claims).toHaveLength(1);
  });

  it("concurrent requests with one key store ONE lead and answer the same lead", async () => {
    const { app } = await boot();
    const key = freshKey();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => submitLead(app, leadBody(), { key })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => (r.json() as { leadId: string }).leadId)).size).toBe(1);
    expect(await leadCount(app)).toBe(1);
  });

  it("the same key in another shop is a different lead (keys are tenant-scoped)", async () => {
    const { app } = await boot();
    const key = freshKey();
    await submitLead(app, leadBody(), { key });
    const other = await submitLead(app, leadBody(), { key, tenantId: "t-2" });
    expect(other.statusCode).toBe(201);
    expect(await leadCount(app, "t-1")).toBe(1);
    expect(await leadCount(app, "t-2")).toBe(1);
  });
});

describe("POST /public/leads — rate limits (D2, fail closed)", () => {
  const leadKeys = (limiter: { keys: string[] }) =>
    limiter.keys.filter((k) => k.includes(":leads"));

  it("the 6th submission from one visitor address in 10 minutes → 429 with retry-after", async () => {
    const { app } = await boot({ rateLimiter: countingLimiter() });
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await submitLead(app, leadBody({ sessionId: `session-${String(i)}` }))).statusCode,
      ).toBe(201);
    }
    const sixth = await submitLead(app, leadBody({ sessionId: "session-6" }));
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers["retry-after"]).toBe("120");
    expect((sixth.json() as { code: string }).code).toBe("RATE_LIMITED");
    expect(await leadCount(app)).toBe(5);
  });

  it("two visitor addresses behind ONE transport address have separate 5-buckets", async () => {
    const limiter = countingLimiter();
    const { app } = await boot({ rateLimiter: limiter });
    const ctx = (ip: string) => ({ ...(leadBody().context as object), ip });
    for (let i = 0; i < 5; i += 1) {
      const res = await submitLead(app, leadBody({ context: ctx("203.0.113.1") }), {
        remoteAddress: "10.0.0.9",
      });
      expect(res.statusCode).toBe(201);
    }
    const other = await submitLead(app, leadBody({ context: ctx("203.0.113.2") }), {
      remoteAddress: "10.0.0.9",
    });
    expect(other.statusCode).toBe(201);
    const refused = await submitLead(app, leadBody({ context: ctx("203.0.113.1") }), {
      remoteAddress: "10.0.0.9",
    });
    expect(refused.statusCode).toBe(429);
    expect(leadKeys(limiter)).toContain("rl:t-1:leads:ip:203.0.113.2");
    expect(leadKeys(limiter).some((k) => k.includes("10.0.0.9"))).toBe(false);
  });

  it("ip: null consumes only the shop bucket", async () => {
    const limiter = countingLimiter();
    const { app } = await boot({ rateLimiter: limiter });
    const ctx = { ...(leadBody().context as object), ip: null };
    const res = await submitLead(app, leadBody({ context: ctx }));
    expect(res.statusCode).toBe(201);
    expect(leadKeys(limiter)).toEqual(["rl:t-1:leads"]);
  });

  it("buckets are separated per shop", async () => {
    const limiter = countingLimiter();
    const { app } = await boot({ rateLimiter: limiter });
    await submitLead(app, leadBody(), { tenantId: "t-1" });
    await submitLead(app, leadBody(), { tenantId: "t-2" });
    expect(leadKeys(limiter)).toEqual([
      "rl:t-1:leads",
      "rl:t-1:leads:ip:203.0.113.7",
      "rl:t-2:leads",
      "rl:t-2:leads:ip:203.0.113.7",
    ]);
  });

  it("the 61st submission to one shop (distinct visitor addresses) → 429", async () => {
    const { app } = await boot({ rateLimiter: countingLimiter() });
    const ctx = (i: number) => ({
      ...(leadBody().context as object),
      ip: `198.51.100.${String(i)}`,
    });
    for (let i = 1; i <= 60; i += 1) {
      const res = await submitLead(app, leadBody({ context: ctx(i), sessionId: `s-${String(i)}` }));
      expect(res.statusCode).toBe(201);
    }
    const last = await submitLead(app, leadBody({ context: ctx(61), sessionId: "s-61" }));
    expect(last.statusCode).toBe(429);
    expect(last.headers["retry-after"]).toBeDefined();
  });

  it("a limiter that throws → 503, no lead saved; after it recovers the SAME key succeeds", async () => {
    let failing = true;
    const limiter: RateLimiter = {
      consume: (key) => {
        // the transport's own public bucket degrades in-process; only the leads buckets fail
        if (failing && key.includes(":leads")) return Promise.reject(new Error("redis down"));
        return Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 });
      },
    };
    const { app, claims } = await boot({ rateLimiter: limiter });
    const key = freshKey();
    const down = await submitLead(app, leadBody(), { key });
    expect(down.statusCode).toBe(503);
    expect((down.json() as { code: string }).code).toBe("UNAVAILABLE");
    expect(claims).toEqual([]);
    expect(await leadCount(app)).toBe(0);

    failing = false;
    const up = await submitLead(app, leadBody(), { key });
    expect(up.statusCode).toBe(201);
    expect(await leadCount(app)).toBe(1);
  });

  it("a denied submission is not replayed once the limit window passes (never stored)", async () => {
    let deny = true;
    const limiter: RateLimiter = {
      consume: (key) =>
        Promise.resolve(
          deny && key.includes(":leads")
            ? { allowed: false, remaining: 0, retryAfterMs: 30_000 }
            : { allowed: true, remaining: 99, retryAfterMs: 0 },
        ),
    };
    const { app } = await boot({ rateLimiter: limiter });
    const key = freshKey();
    expect((await submitLead(app, leadBody(), { key })).statusCode).toBe(429);
    deny = false;
    expect((await submitLead(app, leadBody(), { key })).statusCode).toBe(201);
  });

  it("no limiter configured → 503 and the controller is never called", () => {
    const submit = vi.fn();
    const admin = { publicReads: { leads: { submit } } } as unknown as WiredAdmin;
    const [route] = publicLeadsRoutes(admin, undefined);
    expect(route).toBeDefined();
    return Promise.resolve(
      route!.handle({
        body: leadBody(),
        params: {},
        query: {},
        context: {
          tenantId: "t-1",
          requestId: "r",
          correlationId: "c",
          headers: { "idempotency-key": freshKey() },
          principal: { id: "public", kind: "anonymous", roles: [] },
        },
      } as never),
    ).then((response) => {
      expect(response).toMatchObject({ status: 503, body: { code: "UNAVAILABLE" } });
      expect(submit).not.toHaveBeenCalled();
    });
  });
});

describe("POST /public/leads — shop facts unavailable (finding 2)", () => {
  it("tenancy read rejects → 503, no insert, no claim", async () => {
    const { app, claims, shopReads } = await boot({ shopFactsFail: "reject" });
    const res = await submitLead(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "UNAVAILABLE" });
    expect(JSON.stringify(res.json())).not.toContain("tenancy is down");
    expect(shopReads.count).toBeGreaterThan(0);
    expect(claims).toEqual([]);
    expect(await leadCount(app)).toBe(0);
  });

  it("tenancy answers non-200 → 503, no insert, no claim", async () => {
    const { app, claims } = await boot({ shopFactsFail: "non-200" });
    const res = await submitLead(app);
    expect(res.statusCode).toBe(503);
    expect(claims).toEqual([]);
    expect(await leadCount(app)).toBe(0);
  });
});

describe("POST /public/leads — visitor attribution carried over (Tracking P2-D8)", () => {
  const VISITOR = "0b9f4c1e-3d2a-4f55-8a77-1c2d3e4f5a6b";
  const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  /** The route's own handler with a recording `submit`, so the use-case input is visible. */
  async function submittedContext(context: Record<string, unknown>) {
    const submit = vi.fn().mockResolvedValue({ status: 201, body: {} });
    const admin = { publicReads: { leads: { submit } } } as unknown as WiredAdmin;
    const [route] = publicLeadsRoutes(admin, {
      consume: () => Promise.resolve({ allowed: true, remaining: 9, retryAfterMs: 0 }),
    });
    const body = leadBody({ context: { ...(leadBody().context as object), ...context } });
    await route!.handle({
      body,
      params: {},
      query: {},
      context: {
        tenantId: "t-1",
        requestId: "r",
        correlationId: "c",
        headers: { "idempotency-key": freshKey() },
        principal: { id: "public", kind: "anonymous", roles: [] },
      },
    } as never);
    expect(submit).toHaveBeenCalledTimes(1);
    return (submit.mock.calls[0]?.[0] as { context: Record<string, unknown> }).context;
  }

  it("forwards the visitor id, the click ids inside their window and the UTM labels", async () => {
    const context = await submittedContext({
      visitorId: VISITOR,
      clickIds: [
        { name: "gclid", value: "Cj0KCQ-abc", capturedAt: daysAgo(2) },
        { name: "scclid", value: "snap-old", capturedAt: daysAgo(40) },
        { name: "mystery", value: "x", capturedAt: daysAgo(1) },
      ],
      utm: { source: "facebook", campaign: "eid" },
    });
    expect(context["visitorId"]).toBe(VISITOR);
    expect(context["clickIds"]).toEqual([
      { name: "gclid", value: "Cj0KCQ-abc", capturedAt: expect.any(String) as string },
    ]);
    expect(context["utm"]).toEqual({ source: "facebook", campaign: "eid" });
  });

  it("an old body (no visitor fields) reaches the use case with exactly the old context shape", async () => {
    const context = await submittedContext({});
    expect(Object.keys(context).sort()).toEqual(
      ["cookies", "ip", "pageUrl", "referrer", "userAgent"].sort(),
    );
  });

  it("drops a malformed visitor id instead of failing the lead", async () => {
    const context = await submittedContext({ visitorId: "short" });
    expect(context).not.toHaveProperty("visitorId");
  });

  it("over HTTP: the new fields are accepted; unknown keys, oversize values and 11 click ids are 422", async () => {
    const { app } = await boot();
    const base = leadBody().context as Record<string, unknown>;
    const ok = await submitLead(
      app,
      leadBody({
        context: {
          ...base,
          visitorId: VISITOR,
          clickIds: [{ name: "gclid", value: "abc", capturedAt: daysAgo(1) }],
          utm: { source: "facebook" },
        },
      }),
    );
    expect(ok.statusCode).toBe(201);

    const refused: Record<string, unknown>[] = [
      { visitorId: "v".repeat(49) },
      { utm: { source: "s".repeat(201) } },
      { utm: { source: "x", junk: "y" } },
      { junk: 1 },
      {
        clickIds: Array.from({ length: 11 }, () => ({
          name: "gclid",
          value: "v",
          capturedAt: daysAgo(1),
        })),
      },
      { clickIds: [{ name: "gclid", value: "v".repeat(1001), capturedAt: daysAgo(1) }] },
      { clickIds: [{ name: "gclid", value: "v", capturedAt: daysAgo(1), extra: 1 }] },
    ];
    for (const extra of refused) {
      const res = await submitLead(app, leadBody({ context: { ...base, ...extra } }));
      expect(res.statusCode).toBe(422);
    }
  });
});

describe("POST /public/leads — server tracking event (Tracking P2-D9)", () => {
  function recordingPort() {
    const emitted: { tenantId: string; leadId: string }[] = [];
    const subjects: unknown[] = [];
    let fail = false;
    return {
      emitted,
      subjects,
      failNext: () => {
        fail = true;
      },
      port: {
        emit: (subject: { tenantId: string; leadId: string }) => {
          if (fail) {
            fail = false;
            return Promise.reject(new Error("outbox unavailable"));
          }
          emitted.push({ tenantId: subject.tenantId, leadId: subject.leadId });
          subjects.push(subject);
          return Promise.resolve();
        },
      },
    };
  }

  it("hands the saved lead to the tracking port under the request's tenant, once, without the message", async () => {
    const tracking = recordingPort();
    const { app } = await boot({ leadTracking: tracking.port });
    const res = await submitLead(app, leadBody({ message: "my private words" }));
    expect(res.statusCode).toBe(201);
    const body = res.json() as { leadId: string; emission: string };
    expect(body.emission).toBe("emit");
    expect(tracking.emitted).toEqual([{ tenantId: "t-1", leadId: body.leadId }]);
    expect(JSON.stringify(tracking.subjects)).not.toContain("my private words");
  });

  it("a replay of the same Idempotency-Key and a same-session second lead send nothing more", async () => {
    const tracking = recordingPort();
    const { app } = await boot({ leadTracking: tracking.port });
    const key = freshKey();
    await submitLead(app, leadBody(), { key });
    await submitLead(app, leadBody(), { key });
    await submitLead(app, leadBody({ name: "Second Visitor" }));
    expect(tracking.emitted).toHaveLength(1);
  });

  it("a tracking failure never fails the visitor's submit (201, the lead is saved)", async () => {
    const tracking = recordingPort();
    tracking.failNext();
    const { app } = await boot({ leadTracking: tracking.port });
    const res = await submitLead(app);
    expect(res.statusCode).toBe(201);
    expect((res.json() as { emission: string }).emission).toBe("emit");
    expect(await leadCount(app)).toBe(1);
    expect(tracking.emitted).toHaveLength(0);
  });

  it("spam is saved but never sent", async () => {
    const tracking = recordingPort();
    const { app } = await boot({ leadTracking: tracking.port });
    const res = await submitLead(
      app,
      leadBody({ spamSignals: { honeypot: true, elapsedMs: 8_000 } }),
    );
    expect(res.statusCode).toBe(201);
    expect((res.json() as { emission: string }).emission).toBe("spam");
    expect(tracking.emitted).toHaveLength(0);
  });
});
