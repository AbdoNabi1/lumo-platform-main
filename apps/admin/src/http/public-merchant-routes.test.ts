import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NativeTokenIssuer } from "@platform/auth";
import type { Clock, IdGenerator, RateLimiter } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireLicensing, type WiredLicensing } from "@platform/licensing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { logger } from "@platform/utils";
import { wireAdmin, type WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { publicMerchantRoutes } from "./public-merchant-routes";

const PLATFORM = "platform";
const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };

/** A fixed-window counter, enough to exercise the route's limiter wiring. */
class CountingRateLimiter implements RateLimiter {
  readonly keys: string[] = [];
  private readonly counts = new Map<string, number>();
  consume(key: string, limit: number, windowMs: number) {
    this.keys.push(`${key}|${limit}|${windowMs}`);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve(
      count > limit
        ? { allowed: false, remaining: 0, retryAfterMs: windowMs }
        : { allowed: true, remaining: limit - count, retryAfterMs: 0 },
    );
  }
}

class RecordingSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  send(m: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(m);
    return Promise.resolve();
  }
}

async function seedPlan(licensing: WiredLicensing, key: string): Promise<void> {
  const plan = await licensing.licensing.createPlan({
    key,
    name: "Basic",
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    spec: {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: {
        basePriceMinor: 49_900,
        currency: "EGP",
        billingCycle: "monthly",
        trialDays: 14,
        creditAllowances: {},
      },
    },
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  const published = await licensing.licensing.publishPlanVersion({
    planId,
    planVersionId,
    tenantId: PLATFORM,
  });
  expect(published.status).toBe(200);
}

async function setup() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const serializer = new InMemoryEventSerializer();
  const licensing = wireLicensing({ serializer, idGenerator, clock, platformTenantId: PLATFORM });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sender = new RecordingSender();
  const admin = wireAdmin({
    serializer,
    idGenerator,
    clock,
    licensing,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: new NativeTokenIssuer({
      privateKey,
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      ttlSeconds: 7200,
    }),
    emailSender: sender,
    adminPublicUrl: "https://admin.test",
    platformStoreDomain: "morbeh.test",
    platformTenantId: PLATFORM,
    defaultPlanKey: "basic",
  });
  await seedPlan(licensing, "basic");
  return { admin, sender };
}

const find = (routes: readonly RouteDefinition[], method: string, path: string) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
};

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Parses the body with the route's own schema first, like the transport does (400 on failure). */
async function call(
  route: RouteDefinition,
  body: unknown,
  context: { tenantId?: string; ip?: string } = {},
): Promise<Reply> {
  const parsed = route.schema.body?.safeParse(body);
  if (parsed !== undefined && !parsed.success) {
    return { status: 400, body: { code: "VALIDATION_FAILED" } };
  }
  return (await route.handle({
    body: parsed === undefined ? body : parsed.data,
    params: {},
    query: {},
    context: {
      tenantId: context.tenantId ?? PLATFORM,
      principal: {
        id: "anonymous",
        kind: "customer",
        roles: [],
        tenantId: context.tenantId ?? PLATFORM,
      },
      requestId: "r",
      correlationId: "c",
      ...(context.ip === undefined ? {} : { ip: context.ip }),
    },
  } as never)) as Reply;
}

const SIGNUP = "/public/merchant-signup";
const LOGIN = "/public/auth/merchant/login";
const RESET_REQUEST = "/public/auth/merchant/password-reset/request";
const RESET_COMPLETE = "/public/auth/merchant/password-reset/complete";

const nour = {
  storeName: "Nour Store",
  email: "Owner@Nour.test",
  password: "correct-horse-1",
  country: "SA",
};

describe("merchant sign-up", () => {
  it("creates the store and signs in (201 with a token); the same email again is 409 EMAIL_TAKEN", async () => {
    const { admin } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });
    const signup = find(routes, "POST", SIGNUP);

    const res = await call(signup, nour);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      storeUrl: "https://nour-store.morbeh.test",
      tokenType: "Bearer",
    });
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.tenantId).toBe("string");
    expect(typeof res.body.expiresIn).toBe("number");

    const again = await call(signup, { ...nour, email: "owner@nour.test" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "EMAIL_TAKEN", retryable: false, fields: [] });
  });

  it("is refused on any tenant but the platform's", async () => {
    const { admin } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });
    const res = await call(find(routes, "POST", SIGNUP), nour, { tenantId: "shop-x" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN", retryable: false, fields: [] });
  });

  it("answers 503 SIGNUP_UNAVAILABLE when the deployment has no platform tenant", async () => {
    const { admin } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: undefined });
    const res = await call(find(routes, "POST", SIGNUP), nour);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "SIGNUP_UNAVAILABLE", retryable: true, fields: [] });
  });

  it("answers 503 SIGNUP_UNAVAILABLE, with no internal reason, when onboarding is unavailable", async () => {
    const { admin } = await setup();
    const stub = {
      ...admin,
      merchantOnboarding: {
        signUp: () => Promise.resolve({ kind: "unavailable", reason: "no-default-plan" }),
      },
    } as unknown as WiredAdmin;
    const routes = publicMerchantRoutes(stub, { platformTenantId: PLATFORM });
    const res = await call(find(routes, "POST", SIGNUP), nour);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "SIGNUP_UNAVAILABLE", retryable: true, fields: [] });
    expect(JSON.stringify(res.body)).not.toContain("no-default-plan");
  });

  it("answers 503 SIGNUP_UNAVAILABLE when sign-up throws, and logs the error without the password", async () => {
    const { admin } = await setup();
    const stub = {
      ...admin,
      merchantOnboarding: {
        signUp: () => Promise.reject(new Error("database went away")),
      },
    } as unknown as WiredAdmin;
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const routes = publicMerchantRoutes(stub, { platformTenantId: PLATFORM });
      const res = await call(find(routes, "POST", SIGNUP), nour);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "SIGNUP_UNAVAILABLE", retryable: true, fields: [] });
      expect(JSON.stringify(res.body)).not.toContain("database went away");
      expect(error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(error.mock.calls)).toContain("database went away");
      expect(JSON.stringify(error.mock.calls)).not.toContain(nour.password);
    } finally {
      error.mockRestore();
    }
  });

  it("answers 503 SIGNUP_UNAVAILABLE when native sign-in is not configured, and creates nothing", async () => {
    let n = 0;
    const idGenerator: IdGenerator = {
      generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
    };
    const serializer = new InMemoryEventSerializer();
    const licensing = wireLicensing({ serializer, idGenerator, clock, platformTenantId: PLATFORM });
    // No staff token issuer: nobody could ever sign in to the store sign-up would make.
    const admin = wireAdmin({
      serializer,
      idGenerator,
      clock,
      licensing,
      passwordAuthProvider: new HashedPasswordAuthProvider({
        store: new InMemoryPasswordCredentialStore(),
        hasher: new ScryptPasswordHasher({ log2N: 10 }),
        clock,
      }),
      platformStoreDomain: "morbeh.test",
      platformTenantId: PLATFORM,
      defaultPlanKey: "basic",
    });
    await seedPlan(licensing, "basic");
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });

    const res = await call(find(routes, "POST", SIGNUP), nour);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SIGNUP_UNAVAILABLE");
    expect(await admin.findStoreForEmail("owner@nour.test")).toBeNull();
  });

  it("created but sign-in failed: 201 with signInRequired and no token fields", async () => {
    const { admin } = await setup();
    const failed: AdminResponse = {
      status: 401,
      body: { error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } },
    };
    const stub = {
      ...admin,
      merchantOnboarding: {
        signUp: () =>
          Promise.resolve({
            kind: "created",
            tenantId: "t-1",
            storeUrl: "https://x.morbeh.test",
            session: failed,
          }),
      },
    } as unknown as WiredAdmin;
    const routes = publicMerchantRoutes(stub, { platformTenantId: PLATFORM });
    const res = await call(find(routes, "POST", SIGNUP), nour);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      tenantId: "t-1",
      storeUrl: "https://x.morbeh.test",
      signInRequired: true,
    });
  });

  it("limits 5 per IP per hour and 3 per normalised email per hour, before any work", async () => {
    const { admin } = await setup();
    const limiter = new CountingRateLimiter();
    const routes = publicMerchantRoutes(admin, {
      rateLimiter: limiter,
      platformTenantId: PLATFORM,
    });
    const signup = find(routes, "POST", SIGNUP);
    await call(signup, nour, { ip: "203.0.113.9" });
    expect(limiter.keys).toEqual([
      "rl:signup-ip:203.0.113.9|5|3600000",
      "rl:signup-email:owner@nour.test|3|3600000",
    ]);

    // The 6th attempt from one address is refused (the email bucket is spent on other addresses).
    const sixth = [];
    for (let i = 0; i < 5; i += 1) {
      sixth.push(await call(signup, { ...nour, email: `u${i}@nour.test` }, { ip: "203.0.113.9" }));
    }
    expect(sixth.at(-1)?.status).toBe(429);
    expect(sixth.at(-1)?.body).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(sixth.at(-1)?.headers?.["retry-after"]).toBeDefined();
  });

  it("refuses the 4th sign-up attempt for one email in the hour, whatever the casing", async () => {
    const { admin } = await setup();
    const limiter = new CountingRateLimiter();
    const routes = publicMerchantRoutes(admin, {
      rateLimiter: limiter,
      platformTenantId: PLATFORM,
    });
    const signup = find(routes, "POST", SIGNUP);
    const statuses: number[] = [];
    for (const [i, email] of ["a@x.test", "A@X.test", " a@x.test ", "A@x.TEST"].entries()) {
      statuses.push((await call(signup, { ...nour, email }, { ip: `198.51.100.${i}` })).status);
    }
    expect(statuses[3]).toBe(429);
  });

  it("rejects a 7-character password, an unsupported country, a short name, a missing @, extra keys", async () => {
    const { admin } = await setup();
    const signup = find(
      publicMerchantRoutes(admin, { platformTenantId: PLATFORM }),
      "POST",
      SIGNUP,
    );
    expect((await call(signup, { ...nour, password: "1234567" })).status).toBe(400);
    expect((await call(signup, { ...nour, country: "US" })).status).toBe(400);
    expect((await call(signup, { ...nour, storeName: " a " })).status).toBe(400);
    expect((await call(signup, { ...nour, email: "no-at-sign" })).status).toBe(400);
    expect((await call(signup, { ...nour, tenantId: "other" })).status).toBe(400);
  });
});

describe("merchant login", () => {
  it("right password → 200 with a token; wrong password and unknown email → identical 401", async () => {
    const { admin } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });
    await call(find(routes, "POST", SIGNUP), nour);
    const login = find(routes, "POST", LOGIN);

    const ok = await call(login, { email: " owner@NOUR.test", password: "correct-horse-1" });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.accessToken).toBe("string");

    const wrong = await call(login, { email: "owner@nour.test", password: "wrong-password-1" });
    const unknown = await call(login, { email: "nobody@nour.test", password: "wrong-password-1" });
    expect(wrong).toEqual(unknown);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect",
      retryable: false,
      fields: [],
    });
  });

  it("treats a pending store like an unknown email without trying to sign in", async () => {
    const { admin } = await setup();
    const login = vi.fn();
    const stub = {
      ...admin,
      findStoreForEmail: () => Promise.resolve({ shopId: "half-made", status: "pending" }),
      staffAuth: { login },
    } as unknown as WiredAdmin;
    const routes = publicMerchantRoutes(stub, { platformTenantId: PLATFORM });
    const res = await call(find(routes, "POST", LOGIN), {
      email: "owner@nour.test",
      password: "correct-horse-1",
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect",
      retryable: false,
      fields: [],
    });
    expect(login).not.toHaveBeenCalled();
  });

  it("passes MFA_REQUIRED through and maps every other non-200 to the same 401", async () => {
    const { admin } = await setup();
    const mfa: AdminResponse = {
      status: 403,
      body: { error: { code: "MFA_REQUIRED", message: "more" }, mfaRequirement: "totp" },
    };
    const responses: AdminResponse[] = [mfa, { status: 503, body: {} }];
    const stub = {
      ...admin,
      findStoreForEmail: () => Promise.resolve({ shopId: "s", status: "active" }),
      staffAuth: { login: () => Promise.resolve(responses.shift()) },
    } as unknown as WiredAdmin;
    const login = find(publicMerchantRoutes(stub, { platformTenantId: PLATFORM }), "POST", LOGIN);
    const body = { email: "owner@nour.test", password: "x" };
    expect(await call(login, body)).toEqual({ status: 403, body: mfa.body });
    const other = await call(login, body);
    expect(other.status).toBe(401);
    expect(other.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("answers the same 401 when native sign-in is not configured, and tells the operator", async () => {
    const { admin } = await setup();
    const notConfigured: AdminResponse = {
      status: 503,
      body: {
        error: { code: "NOT_CONFIGURED", message: "Native staff sign-in is not configured" },
      },
    };
    const stub = {
      ...admin,
      findStoreForEmail: () => Promise.resolve({ shopId: "s", status: "active" }),
      staffAuth: { login: () => Promise.resolve(notConfigured) },
    } as unknown as WiredAdmin;
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const login = find(publicMerchantRoutes(stub, { platformTenantId: PLATFORM }), "POST", LOGIN);
      const res = await call(login, { email: "owner@nour.test", password: "correct-horse-1" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_CREDENTIALS");
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toContain("native staff sign-in is not configured");
      expect(JSON.stringify(error.mock.calls)).not.toContain("correct-horse-1");
    } finally {
      error.mockRestore();
    }
  });

  it("limits 10 per email per 15 minutes, and refuses non-platform tenants", async () => {
    const { admin } = await setup();
    const limiter = new CountingRateLimiter();
    const routes = publicMerchantRoutes(admin, {
      rateLimiter: limiter,
      platformTenantId: PLATFORM,
    });
    const login = find(routes, "POST", LOGIN);
    expect(
      (await call(login, { email: "A@b.test", password: "x" }, { tenantId: "shop-x" })).body.code,
    ).toBe("FORBIDDEN");
    for (let i = 0; i < 10; i += 1) await call(login, { email: "A@b.test", password: "x" });
    const refused = await call(login, { email: "a@B.test", password: "x" });
    expect(refused.status).toBe(429);
    expect(new Set(limiter.keys)).toEqual(new Set(["rl:merchant-login:a@b.test|10|900000"]));
  });
});

describe("merchant password reset", () => {
  it("answers 202 {} for an unknown and a known email; only the known one is emailed, with the store id", async () => {
    const { admin, sender } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });
    const signed = await call(find(routes, "POST", SIGNUP), nour);
    const tenantId = signed.body.tenantId as string;
    const request = find(routes, "POST", RESET_REQUEST);

    const unknown = await call(request, { email: "nobody@nour.test" });
    expect(unknown).toMatchObject({ status: 202, body: {} });
    expect(sender.sent).toHaveLength(0);

    const known = await call(request, { email: "Owner@Nour.test" });
    expect(known).toMatchObject({ status: 202, body: {} });
    expect(Object.keys(known.body)).toEqual([]);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("owner@nour.test");
    expect(sender.sent[0]?.text).toContain(`&store=${encodeURIComponent(tenantId)}`);
  });

  it("completes a reset with the emailed token and store, then the new password signs in", async () => {
    const { admin, sender } = await setup();
    const routes = publicMerchantRoutes(admin, { platformTenantId: PLATFORM });
    const signed = await call(find(routes, "POST", SIGNUP), nour);
    const tenantId = signed.body.tenantId as string;
    await call(find(routes, "POST", RESET_REQUEST), { email: "owner@nour.test" });
    const token = /token=([A-Za-z0-9_-]+)/.exec(sender.sent[0]?.text ?? "")?.[1] ?? "";
    expect(token).not.toBe("");

    const done = await call(find(routes, "POST", RESET_COMPLETE), {
      store: tenantId,
      token,
      password: "brand-new-pass-1",
    });
    expect(done.status).toBe(200);
    const login = find(routes, "POST", LOGIN);
    expect(
      (await call(login, { email: "owner@nour.test", password: "brand-new-pass-1" })).status,
    ).toBe(200);
    expect(
      (await call(login, { email: "owner@nour.test", password: "correct-horse-1" })).status,
    ).toBe(401);
  });

  it("limits reset requests to 5 per email per hour, and validates the complete body", async () => {
    const { admin } = await setup();
    const limiter = new CountingRateLimiter();
    const routes = publicMerchantRoutes(admin, {
      rateLimiter: limiter,
      platformTenantId: PLATFORM,
    });
    const request = find(routes, "POST", RESET_REQUEST);
    for (let i = 0; i < 5; i += 1) await call(request, { email: "a@b.test" });
    expect((await call(request, { email: "A@b.test" })).status).toBe(429);
    expect(limiter.keys[0]).toBe("rl:merchant-reset:a@b.test|5|3600000");

    const complete = find(routes, "POST", RESET_COMPLETE);
    expect((await call(complete, { store: "s", token: "t", password: "short" })).status).toBe(400);
    expect(
      (await call(complete, { store: "", token: "t", password: "long-enough-1" })).status,
    ).toBe(400);
  });
});
