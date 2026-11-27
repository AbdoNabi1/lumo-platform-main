import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  JwtVerifier,
  NativeTokenIssuer,
  RoleTableAccessControl,
  localKeyResolver,
} from "@platform/auth";
import type {
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing, type WiredLicensing } from "@platform/licensing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { createAdminHttpApi } from "./server";

/**
 * Wave 1f — two-step verification is MANDATORY (`staffTwoStepRequired: true`), driven through the REAL admin pipeline
 * (`createAdminHttpApi`, `tenantMode: "multi"`): merchant sign-up for the stores, real invite/accept for
 * every member, the real `RoleTableAccessControl` behind the live staff access control, a real
 * `NativeTokenIssuer` (challenges and staff tokens) and in-memory Security over `InMemoryTotpMfaProvider`
 * (the code "123456", valid once per 30 s step through the enrolment's replay guard). The app clock is
 * ours: `nextStep()` moves it one TOTP step on, which is how a second code becomes valid. Only the
 * Redis-shaped ports and the email sender are doubles.
 *
 * Layer under test: application (transport + composition). No RLS, no Postgres.
 */

const PLATFORM = "platform";
const API = "/api/v1";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "correct horse 1";
const CODE = "123456";
const BASE_MS = Date.now();
const STEP_MS = 31_000;

/** The app clock. It only moves forward: a code step already used must never become valid again. */
const clockState = { offsetMs: 0 };
const clock: Clock = { now: () => new Date(BASE_MS + clockState.offsetMs) };
const nextStep = (): void => {
  clockState.offsetMs += STEP_MS;
};

class RecordingSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
  tokenFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const token = /accept-invite\?token=([^&\s]+)&store=/.exec(mail?.text ?? "")?.[1];
    if (token === undefined) throw new Error(`no invitation email for ${to}`);
    return decodeURIComponent(token);
  }
}

/** A windowed counter on the APP clock that records every key and can be told to fail. */
class WindowedLimiter implements RateLimiter {
  readonly calls: string[] = [];
  failWhen: ((key: string) => boolean) | null = null;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  consume(key: string, limit: number, windowMs: number) {
    this.calls.push(`${key}|${limit}|${windowMs}`);
    if (this.failWhen?.(key) === true) return Promise.reject(new Error("redis down"));
    // Sign-up throttling (5 per hour per address) is not under test; seven stores are created here.
    if (key.startsWith("rl:signup-")) {
      return Promise.resolve({ allowed: true, remaining: limit, retryAfterMs: 0 });
    }
    const now = clock.now().getTime();
    const current = this.hits.get(key);
    const entry =
      current !== undefined && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    this.hits.set(key, entry);
    const allowed = entry.count <= limit;
    return Promise.resolve({
      allowed,
      remaining: Math.max(0, limit - entry.count),
      retryAfterMs: allowed ? 0 : entry.resetAt - now,
    });
  }
  mfaCalls(): string[] {
    return this.calls.filter((call) => call.includes("staff-mfa") || call.includes("mfa-chal"));
  }
}

async function seedBasicPlan(licensing: WiredLicensing): Promise<void> {
  const plan = await licensing.licensing.createPlan({
    key: "basic",
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

const claimsOf = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

interface Harness {
  readonly app: FastifyInstance;
  readonly sender: RecordingSender;
  readonly issuer: NativeTokenIssuer;
  readonly limiter: WindowedLimiter;
  readonly verifier: JwtVerifier;
}

async function boot(options: {
  mfaConfigured: boolean;
  staffTwoStepRequired?: boolean;
}): Promise<Harness> {
  let n = 0;
  const idGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const serializer = new InMemoryEventSerializer();
  const licensing = wireLicensing({ serializer, idGenerator, clock, platformTenantId: PLATFORM });
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const issuer = new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
    now: () => clock.now(),
  });
  const resolver = localKeyResolver(issuer);
  const authenticator = new JwtVerifier({
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    getKey: (header, token) => resolver.then((getKey) => getKey(header, token)),
    logger: silent,
  });
  const sender = new RecordingSender();
  const kv = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const limiter = new WindowedLimiter();
  const app = await createAdminHttpApi({
    tenantMode: "multi",
    tenantId: PLATFORM,
    serializer,
    idGenerator,
    clock,
    licensing,
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter: limiter,
    idempotencyKeys,
    responseCache: cache,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: issuer,
    mfaConfigured: options.mfaConfigured,
    ...(options.staffTwoStepRequired === undefined
      ? {}
      : { staffTwoStepRequired: options.staffTwoStepRequired }),
    emailSender: sender,
    staffInviteEmailSender: sender,
    adminPublicUrl: "https://admin.test",
    platformStoreDomain: "morbeh.test",
    dnsVerifier: { pointsToPlatform: async () => false },
    defaultPlanKey: "basic",
  });
  await seedBasicPlan(licensing);
  return { app, sender, issuer, limiter, verifier: authenticator };
}

interface Store {
  readonly tenantId: string;
  readonly token: string;
  readonly email: string;
}
interface Member {
  readonly email: string;
  readonly externalId: string;
  readonly token: string;
}
type Role = "admin" | "operator" | "viewer";

let h: Harness;
let app: FastifyInstance;
let sender: RecordingSender;
let limiter: WindowedLimiter;
let alpha: Store;
let beta: Store;
let alphaAdmin: Member;
let alphaOperator: Member;
let alphaViewer: Member;

const headers = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  ...extra,
});
const get = (token: string, url: string, target: FastifyInstance = app) =>
  target.inject({ method: "GET", url: `${API}${url}`, headers: headers(token) });
const post = (
  token: string,
  url: string,
  payload: unknown = {},
  key: string = randomUUID(),
  target: FastifyInstance = app,
) =>
  target.inject({
    method: "POST",
    url: `${API}${url}`,
    headers: headers(token, { "idempotency-key": key }),
    payload: payload as object,
  });
const publicPost = (url: string, tenant: string, payload: unknown, target: FastifyInstance = app) =>
  target.inject({
    method: "POST",
    url: `${API}${url}`,
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    payload: payload as object,
  });
const body = (res: LightMyRequestResponse) => res.json() as Record<string, unknown>;
const errorOf = (res: LightMyRequestResponse) =>
  (body(res).error ?? {}) as { code?: string; message?: string };
const uniqueEmail = (label: string, domain = "alpha.test") =>
  `${label}-${randomUUID().slice(0, 8)}@${domain}`;

const staffLogin = (tenant: string, email: string, password: string, target = app) =>
  publicPost("/public/auth/staff/login", tenant, { email, password }, target);
const staffSetupStart = (tenant: string, setupChallenge: string, target = app) =>
  publicPost("/public/auth/staff/login/setup/start", tenant, { setupChallenge }, target);
const staffSetupConfirm = (
  tenant: string,
  setupChallenge: string,
  enrollmentId: string,
  code: string,
  target = app,
) =>
  publicPost(
    "/public/auth/staff/login/setup/confirm",
    tenant,
    { setupChallenge, enrollmentId, code },
    target,
  );
const staffVerify = (tenant: string, challenge: string, code: string) =>
  publicPost("/public/auth/staff/login/verify", tenant, { challenge, code });
const merchantLogin = (email: string, password: string) =>
  publicPost("/public/auth/merchant/login", PLATFORM, { email, password });
const merchantSetupStart = (setupChallenge: string, tenant = PLATFORM) =>
  publicPost("/public/auth/merchant/login/setup/start", tenant, { setupChallenge });
const merchantSetupConfirm = (
  setupChallenge: string,
  enrollmentId: string,
  code: string,
  tenant = PLATFORM,
) =>
  publicPost("/public/auth/merchant/login/setup/confirm", tenant, {
    setupChallenge,
    enrollmentId,
    code,
  });
const accept = (store: Store, token: string, password: string) =>
  publicPost("/public/auth/staff/invitations/accept", store.tenantId, { token, password });

/** Staff password step that must end in "set up two-step first": returns the setup challenge. */
async function expectSetupRequired(tenant: string, email: string, password: string) {
  const res = await staffLogin(tenant, email, password);
  expect(res.statusCode).toBe(403);
  expect(errorOf(res).code).toBe("MFA_SETUP_REQUIRED");
  return body(res).setupChallenge as string;
}

/** The whole setup at sign-in for a staff member: password → start → confirm. */
async function setUpAtSignIn(tenant: string, email: string, password: string) {
  const setupChallenge = await expectSetupRequired(tenant, email, password);
  const started = await staffSetupStart(tenant, setupChallenge);
  expect(started.statusCode).toBe(201);
  const confirmed = await staffSetupConfirm(
    tenant,
    setupChallenge,
    body(started).enrollmentId as string,
    CODE,
  );
  expect(confirmed.statusCode).toBe(200);
  nextStep();
  return {
    token: body(confirmed).accessToken as string,
    backupCodes: body(confirmed).backupCodes as string[],
  };
}

/** The merchant's way in: sign-up (no token while the rule is on) → merchant login → setup → token. */
async function signUpStore(storeName: string, email: string): Promise<Store> {
  const res = await publicPost("/public/merchant-signup", PLATFORM, {
    storeName,
    email,
    password: PASSWORD,
    country: "EG",
    siteType: "store",
  });
  expect(res.statusCode).toBe(201);
  const created = body(res);
  // The automatic sign-in can't finish while two-step is mandatory: no token, the merchant signs in.
  expect(created.accessToken).toBeUndefined();
  expect(created.signInRequired).toBe(true);
  const login = await merchantLogin(email, PASSWORD);
  expect(login.statusCode).toBe(403);
  expect(errorOf(login).code).toBe("MFA_SETUP_REQUIRED");
  const setupChallenge = body(login).setupChallenge as string;
  const started = await merchantSetupStart(setupChallenge);
  expect(started.statusCode).toBe(201);
  const confirmed = await merchantSetupConfirm(
    setupChallenge,
    body(started).enrollmentId as string,
    CODE,
  );
  expect(confirmed.statusCode).toBe(200);
  nextStep();
  return {
    tenantId: created.tenantId as string,
    token: body(confirmed).accessToken as string,
    email,
  };
}

/** Invite + read the emailed link + accept; the member has NOT signed in or set up two-step yet. */
async function invite(store: Store, email: string, role: Role) {
  const invited = await post(store.token, "/staff/invitations", { email, role });
  expect(invited.statusCode).toBe(201);
  const { principalExternalId } = invited.json() as { principalExternalId: string };
  expect((await accept(store, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  return { email, externalId: principalExternalId };
}
async function onboard(store: Store, email: string, role: Role): Promise<Member> {
  const person = await invite(store, email, role);
  const { token } = await setUpAtSignIn(store.tenantId, email, NEW_PASSWORD);
  return { ...person, token };
}

const staffListOf = async (token: string) => {
  const res = await get(token, "/staff");
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: { email: string; twoStep: boolean }[] }).items;
};

beforeAll(async () => {
  h = await boot({ mfaConfigured: true, staffTwoStepRequired: true });
  app = h.app;
  sender = h.sender;
  limiter = h.limiter;
  alpha = await signUpStore("Alpha Store", "owner@alpha.test");
  beta = await signUpStore("Beta Store", "owner@beta.test");
  alphaAdmin = await onboard(alpha, "admin@alpha.test", "admin");
  alphaOperator = await onboard(alpha, "operator@alpha.test", "operator");
  alphaViewer = await onboard(alpha, "viewer@alpha.test", "viewer");
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  expect.hasAssertions();
  limiter.failWhen = null;
});

describe("sign-in without two-step while the rule is on", () => {
  it("staff login: 403 MFA_SETUP_REQUIRED with a setup challenge, no token, no session claims in it", async () => {
    const person = await invite(alpha, uniqueEmail("fresh"), "viewer");
    const res = await staffLogin(alpha.tenantId, person.email, NEW_PASSWORD);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: "MFA_SETUP_REQUIRED",
        message: "Set up two-step verification to continue",
      },
      setupChallenge: expect.any(String),
      setupChallengeExpiresIn: 600,
    });
    expect(body(res).accessToken).toBeUndefined();
    expect(body(res).challenge).toBeUndefined();
    const claims = claimsOf(body(res).setupChallenge as string);
    for (const claim of ["kind", "roles", "sid"]) expect(claims).not.toHaveProperty(claim);
    expect(claims.purpose).toBe("staff-login-mfa-setup");
  });

  it("a wrong password is still the plain 401 (no setup challenge for a stranger)", async () => {
    const person = await invite(alpha, uniqueEmail("wrongpw"), "viewer");
    const res = await staffLogin(alpha.tenantId, person.email, "not the password");
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.json())).not.toContain("setupChallenge");
  });

  it("start: 201 key + link labelled with the EMAIL, no-store, never replayed from the idempotency cache", async () => {
    const person = await invite(alpha, uniqueEmail("start"), "operator");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const first = await staffSetupStart(alpha.tenantId, setupChallenge);
    expect(first.statusCode).toBe(201);
    expect(first.headers["cache-control"]).toContain("no-store");
    const out = body(first);
    expect(Object.keys(out).sort()).toEqual(["enrollmentId", "manualKey", "provisioningUri"]);
    expect(out.provisioningUri).toContain(
      `otpauth://totp/Morbeh:${encodeURIComponent(person.email)}`,
    );
    expect(out.provisioningUri).not.toContain(person.externalId);
    const second = await publicPost("/public/auth/staff/login/setup/start", alpha.tenantId, {
      setupChallenge,
    });
    expect(second.statusCode).toBe(201);
    expect(body(second).enrollmentId).not.toBe(out.enrollmentId);
    expect(second.headers["cache-control"]).toContain("no-store");
  });

  it("confirm: a wrong code is 401 INVALID_CODE (nested), no token; the right one gives a token + 10 backup codes, no-store", async () => {
    const person = await invite(alpha, uniqueEmail("confirm"), "admin");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const started = body(await staffSetupStart(alpha.tenantId, setupChallenge));
    const wrong = await staffSetupConfirm(
      alpha.tenantId,
      setupChallenge,
      started.enrollmentId as string,
      "000000",
    );
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({
      error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
    });
    expect(wrong.headers["cache-control"]).toContain("no-store");

    const right = await staffSetupConfirm(
      alpha.tenantId,
      setupChallenge,
      started.enrollmentId as string,
      CODE,
    );
    expect(right.statusCode).toBe(200);
    expect(right.headers["cache-control"]).toContain("no-store");
    const out = body(right);
    expect(Object.keys(out).sort()).toEqual([
      "accessToken",
      "backupCodes",
      "expiresIn",
      "tokenType",
    ]);
    expect(out.tokenType).toBe("Bearer");
    const codes = out.backupCodes as string[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    // The token is a real staff session: it reads its own two-step, now on and platform-required.
    const status = await get(out.accessToken as string, "/auth/staff/two-step");
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      enabled: true,
      backupCodesLeft: 10,
      platformRequired: true,
    });
    expect(status.headers["cache-control"]).toContain("no-store");

    // The next sign-in is the 1e code step: they are enrolled now.
    nextStep();
    const again = await staffLogin(alpha.tenantId, person.email, NEW_PASSWORD);
    expect(again.statusCode).toBe(403);
    expect(errorOf(again).code).toBe("MFA_REQUIRED");
    expect(body(again).challenge).toEqual(expect.any(String));
    expect(body(again).setupChallenge).toBeUndefined();
    const verified = await staffVerify(alpha.tenantId, body(again).challenge as string, CODE);
    expect(verified.statusCode).toBe(200);
  });

  it("the setup challenge is burned after success: start and confirm with it again are 401 CHALLENGE_EXPIRED", async () => {
    const person = await invite(alpha, uniqueEmail("burn"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const started = body(await staffSetupStart(alpha.tenantId, setupChallenge));
    const done = await staffSetupConfirm(
      alpha.tenantId,
      setupChallenge,
      started.enrollmentId as string,
      CODE,
    );
    expect(done.statusCode).toBe(200);
    nextStep();
    for (const res of [
      await staffSetupConfirm(alpha.tenantId, setupChallenge, started.enrollmentId as string, CODE),
      await staffSetupStart(alpha.tenantId, setupChallenge),
    ]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: "CHALLENGE_EXPIRED", message: "Your sign-in expired. Start again." },
      });
    }
    // The burn itself is recorded against the challenge id, not a person.
    expect(limiter.calls.some((call) => call.startsWith("rl:mfa-setup:"))).toBe(true);
  });

  it("a setup challenge is not a code challenge, not a session; a code challenge is not a setup challenge", async () => {
    const enrolled = alphaAdmin;
    const code = await staffLogin(alpha.tenantId, enrolled.email, NEW_PASSWORD);
    expect(errorOf(code).code).toBe("MFA_REQUIRED");
    const codeChallenge = body(code).challenge as string;

    const person = await invite(alpha, uniqueEmail("cross"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);

    // code challenge on the setup routes
    expect((await staffSetupStart(alpha.tenantId, codeChallenge)).statusCode).toBe(401);
    const asConfirm = await staffSetupConfirm(alpha.tenantId, codeChallenge, randomUUID(), CODE);
    expect(asConfirm.statusCode).toBe(401);
    expect(errorOf(asConfirm).code).toBe("CHALLENGE_EXPIRED");
    // setup challenge on the verify route
    nextStep();
    const asVerify = await staffVerify(alpha.tenantId, setupChallenge, CODE);
    expect(asVerify.statusCode).toBe(401);
    expect(errorOf(asVerify).code).toBe("CHALLENGE_EXPIRED");
    // setup challenge as a session token
    const asSession = await get(setupChallenge, "/staff");
    expect(asSession.statusCode).toBe(401);
    // …and the legitimate uses are untouched by all of the above
    expect((await staffSetupStart(alpha.tenantId, setupChallenge)).statusCode).toBe(201);
    expect((await staffVerify(alpha.tenantId, codeChallenge, CODE)).statusCode).toBe(200);
  });

  it("a setup challenge of tenant A on tenant B's staff route is 401 and starts nothing", async () => {
    const person = await invite(alpha, uniqueEmail("tenant"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const start = await staffSetupStart(beta.tenantId, setupChallenge);
    expect(start.statusCode).toBe(401);
    expect(errorOf(start).code).toBe("CHALLENGE_EXPIRED");
    const confirm = await staffSetupConfirm(beta.tenantId, setupChallenge, randomUUID(), CODE);
    expect(confirm.statusCode).toBe(401);
    expect(errorOf(confirm).code).toBe("CHALLENGE_EXPIRED");
    // still usable on its own tenant
    expect((await staffSetupStart(alpha.tenantId, setupChallenge)).statusCode).toBe(201);
  });

  it("another member's enrolment id (or a stale one) cannot be confirmed with someone else's challenge", async () => {
    const a = await invite(alpha, uniqueEmail("ea"), "viewer");
    const b = await invite(alpha, uniqueEmail("eb"), "viewer");
    const chalA = await expectSetupRequired(alpha.tenantId, a.email, NEW_PASSWORD);
    const chalB = await expectSetupRequired(alpha.tenantId, b.email, NEW_PASSWORD);
    const startedB = body(await staffSetupStart(alpha.tenantId, chalB));
    const crossed = await staffSetupConfirm(
      alpha.tenantId,
      chalA,
      startedB.enrollmentId as string,
      CODE,
    );
    expect(crossed.statusCode).toBe(401);
    expect(body(crossed).accessToken).toBeUndefined();
    // B's own setup still works afterwards.
    const ok = await staffSetupConfirm(
      alpha.tenantId,
      chalB,
      startedB.enrollmentId as string,
      CODE,
    );
    expect(ok.statusCode).toBe(200);
    nextStep();
  });

  it("the 7th confirm attempt for one member in ten minutes is 429 with retry-after; the right code no longer helps", async () => {
    const person = await invite(alpha, uniqueEmail("limit"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const started = body(await staffSetupStart(alpha.tenantId, setupChallenge));
    const id = started.enrollmentId as string;
    for (let i = 0; i < 6; i += 1) {
      const res = await staffSetupConfirm(alpha.tenantId, setupChallenge, id, "000000");
      expect(res.statusCode).toBe(401);
    }
    const seventh = await staffSetupConfirm(alpha.tenantId, setupChallenge, id, CODE);
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(Number(seventh.headers["retry-after"])).toBeGreaterThan(0);
    expect(JSON.stringify(seventh.json())).not.toContain("accessToken");
  });

  it("the 7th start is 429 too, and a limiter outage FAILS CLOSED (429, nothing started)", async () => {
    const person = await invite(alpha, uniqueEmail("startlimit"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    for (let i = 0; i < 6; i += 1) {
      expect((await staffSetupStart(alpha.tenantId, setupChallenge)).statusCode).toBe(201);
    }
    expect((await staffSetupStart(alpha.tenantId, setupChallenge)).statusCode).toBe(429);

    const other = await invite(alpha, uniqueEmail("down"), "viewer");
    const chal = await expectSetupRequired(alpha.tenantId, other.email, NEW_PASSWORD);
    limiter.failWhen = (key) => key.includes("staff-mfa-setup");
    const down = await staffSetupStart(alpha.tenantId, chal);
    expect(down.statusCode).toBe(429);
    expect(JSON.stringify(down.json())).not.toContain("manualKey");
    const downConfirm = await staffSetupConfirm(alpha.tenantId, chal, randomUUID(), CODE);
    expect(downConfirm.statusCode).toBe(429);
    limiter.failWhen = null;
  });

  it("a limiter outage on the burn after a right code fails closed: no token", async () => {
    const person = await invite(alpha, uniqueEmail("burndown"), "viewer");
    const setupChallenge = await expectSetupRequired(alpha.tenantId, person.email, NEW_PASSWORD);
    const started = body(await staffSetupStart(alpha.tenantId, setupChallenge));
    limiter.failWhen = (key) => key.startsWith("rl:mfa-setup:");
    const res = await staffSetupConfirm(
      alpha.tenantId,
      setupChallenge,
      started.enrollmentId as string,
      CODE,
    );
    expect(res.statusCode).toBe(429);
    expect(JSON.stringify(res.json())).not.toContain("accessToken");
    limiter.failWhen = null;
  });
});

describe("merchant twins (platform tenant, the store comes from the signed challenge)", () => {
  it("login → setup start → confirm → token that works on the merchant's OWN store", async () => {
    const email = uniqueEmail("merchant", "gamma.test");
    const store = await signUpStore("Gamma Store", email);
    const status = await get(store.token, "/auth/staff/two-step");
    expect(status.json()).toMatchObject({ enabled: true, platformRequired: true });
    // the merchant's own store sees them, with two-step on
    const list = await staffListOf(store.token);
    expect(list.find((m) => m.email === email)?.twoStep).toBe(true);
    // next login is the code step
    const login = await merchantLogin(email, PASSWORD);
    expect(errorOf(login).code).toBe("MFA_REQUIRED");
  });

  it("the platform gate applies: another tenant's merchant setup routes are 403, no challenge is looked at", async () => {
    const email = uniqueEmail("gate", "gamma.test");
    await publicPost("/public/merchant-signup", PLATFORM, {
      storeName: "Gate Store",
      email,
      password: PASSWORD,
      country: "EG",
      siteType: "store",
    });
    const login = await merchantLogin(email, PASSWORD);
    const setupChallenge = body(login).setupChallenge as string;
    expect((await merchantSetupStart(setupChallenge, alpha.tenantId)).statusCode).toBe(403);
    expect(
      (await merchantSetupConfirm(setupChallenge, randomUUID(), CODE, alpha.tenantId)).statusCode,
    ).toBe(403);
    expect((await merchantSetupStart(setupChallenge)).statusCode).toBe(201);
  });

  it("the merchant routes refuse a code challenge and a burned setup challenge exactly like the staff routes", async () => {
    const email = uniqueEmail("mcross", "gamma.test");
    const store = await signUpStore("Cross Store", email);
    void store;
    const codeLogin = await merchantLogin(email, PASSWORD);
    const codeChallenge = body(codeLogin).challenge as string;
    expect((await merchantSetupStart(codeChallenge)).statusCode).toBe(401);
    expect(errorOf(await merchantSetupConfirm(codeChallenge, randomUUID(), CODE)).code).toBe(
      "CHALLENGE_EXPIRED",
    );
  });

  it("the 7th merchant confirm for one member is 429", async () => {
    const email = uniqueEmail("mlimit", "gamma.test");
    await publicPost("/public/merchant-signup", PLATFORM, {
      storeName: "Limit Store",
      email,
      password: PASSWORD,
      country: "EG",
      siteType: "store",
    });
    const login = await merchantLogin(email, PASSWORD);
    const setupChallenge = body(login).setupChallenge as string;
    const started = body(await merchantSetupStart(setupChallenge));
    for (let i = 0; i < 6; i += 1) {
      expect(
        (await merchantSetupConfirm(setupChallenge, started.enrollmentId as string, "000000"))
          .statusCode,
      ).toBe(401);
    }
    expect(
      (await merchantSetupConfirm(setupChallenge, started.enrollmentId as string, CODE)).statusCode,
    ).toBe(429);
  });
});

describe("the rule can't be turned off", () => {
  it("disable → 409 TWO_STEP_REQUIRED (flat) before the password is even asked", async () => {
    const wrongPassword = await post(alphaAdmin.token, "/auth/staff/two-step/disable", {
      password: "definitely not it",
    });
    expect(wrongPassword.statusCode).toBe(409);
    expect(wrongPassword.json()).toMatchObject({
      code: "TWO_STEP_REQUIRED",
      message: "Two-step verification is required for everyone, so it can't be turned off",
    });
    const rightPassword = await post(alphaAdmin.token, "/auth/staff/two-step/disable", {
      password: NEW_PASSWORD,
    });
    expect(rightPassword.statusCode).toBe(409);
    expect(body(await get(alphaAdmin.token, "/auth/staff/two-step"))).toMatchObject({
      enabled: true,
    });
  });

  it("policy GET says platformRequired; policy POST (either value) is 409 TWO_STEP_REQUIRED and changes nothing", async () => {
    const policy = await get(alpha.token, "/staff/security-policy");
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ platformRequired: true, requireTwoStep: false });
    for (const requireTwoStep of [true, false]) {
      const res = await post(alpha.token, "/staff/security-policy", { requireTwoStep });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: "TWO_STEP_REQUIRED" });
    }
    expect((await get(alpha.token, "/staff/security-policy")).json()).toMatchObject({
      requireTwoStep: false,
    });
    // permission still first: an operator is 403, not 409
    expect(
      (await post(alphaOperator.token, "/staff/security-policy", { requireTwoStep: true }))
        .statusCode,
    ).toBe(403);
  });
});

describe("admin reset of a colleague's two-step: POST /staff/:id/two-step/reset", () => {
  it("revokes the enrolment and sessions; the member's next sign-in is the setup again, then works", async () => {
    const victim = await onboard(alpha, uniqueEmail("victim"), "operator");
    expect((await staffListOf(alpha.token)).find((m) => m.email === victim.email)?.twoStep).toBe(
      true,
    );

    const res = await post(alphaAdmin.token, `/staff/${victim.externalId}/two-step/reset`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reset: true, revokedEnrollments: 1 });
    expect((await staffListOf(alpha.token)).find((m) => m.email === victim.email)?.twoStep).toBe(
      false,
    );

    const afterLogin = await staffLogin(alpha.tenantId, victim.email, NEW_PASSWORD);
    expect(afterLogin.statusCode).toBe(403);
    expect(errorOf(afterLogin).code).toBe("MFA_SETUP_REQUIRED");
    // …and a fresh setup puts them back in.
    const again = await setUpAtSignIn(alpha.tenantId, victim.email, NEW_PASSWORD);
    expect(again.backupCodes).toHaveLength(10);
    expect((await get(again.token, "/auth/staff/two-step")).json()).toMatchObject({
      enabled: true,
    });
  });

  it("the owner may reset an admin; the activity list records who reset whom", async () => {
    const target = await onboard(alpha, uniqueEmail("act"), "viewer");
    const res = await post(alpha.token, `/staff/${target.externalId}/two-step/reset`, {});
    expect(res.statusCode).toBe(200);
    const activity = await get(alpha.token, "/staff/activity?limit=50");
    const items = (activity.json() as { items: { kind: string; subjectEmail: string | null }[] })
      .items;
    expect(items.some((i) => i.kind === "two_step_reset" && i.subjectEmail === target.email)).toBe(
      true,
    );
  });

  it("the owner's can't be reset (409) and nobody resets their own (409)", async () => {
    const owner = (await staffListOf(alpha.token)).find((m) => m.email === alpha.email);
    expect(owner?.twoStep).toBe(true);
    const list = (await get(alpha.token, "/staff").then((r) => r.json())) as {
      items: { email: string; principalExternalId: string }[];
    };
    const ownerId = list.items.find((m) => m.email === alpha.email)!.principalExternalId;
    const ofOwner = await post(alphaAdmin.token, `/staff/${ownerId}/two-step/reset`, {});
    expect(ofOwner.statusCode).toBe(409);
    expect(ofOwner.json()).toMatchObject({
      message: "The store owner's two-step verification can't be reset",
    });
    const self = await post(alphaAdmin.token, `/staff/${alphaAdmin.externalId}/two-step/reset`, {});
    expect(self.statusCode).toBe(409);
    expect(self.json()).toMatchObject({
      message: "Reset your own two-step from your account page",
    });
    // both are still enrolled
    expect((await staffListOf(alpha.token)).filter((m) => m.twoStep).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("an operator and a viewer are 403; an unknown member is 404; another store's member is 404", async () => {
    for (const token of [alphaOperator.token, alphaViewer.token]) {
      const res = await post(token, `/staff/${alphaAdmin.externalId}/two-step/reset`, {});
      expect(res.statusCode).toBe(403);
    }
    expect((await post(alpha.token, `/staff/${randomUUID()}/two-step/reset`, {})).statusCode).toBe(
      404,
    );
    const betaMember = await onboard(beta, uniqueEmail("bmember", "beta.test"), "viewer");
    const crossStore = await post(
      alpha.token,
      `/staff/${betaMember.externalId}/two-step/reset`,
      {},
    );
    expect(crossStore.statusCode).toBe(404);
    expect((await staffListOf(beta.token)).find((m) => m.email === betaMember.email)?.twoStep).toBe(
      true,
    );
  });

  it("a body with extra keys is refused (422) — nobody is named in the body", async () => {
    const res = await post(alphaAdmin.token, `/staff/${alphaOperator.externalId}/two-step/reset`, {
      principalExternalId: alphaViewer.externalId,
    });
    expect(res.statusCode).toBe(422);
  });
});
