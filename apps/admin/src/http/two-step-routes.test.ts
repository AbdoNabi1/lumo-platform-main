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
 * Wave 1e — two-step verification and staff activity, driven through the REAL admin pipeline
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

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

interface Harness {
  readonly app: FastifyInstance;
  readonly sender: RecordingSender;
  readonly issuer: NativeTokenIssuer;
  readonly limiter: WindowedLimiter;
  readonly verifier: JwtVerifier;
}

async function boot(options: { mfaConfigured: boolean }): Promise<Harness> {
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
  readonly invitationId: string;
  readonly token: string;
}
type Role = "admin" | "operator" | "viewer";
interface ActivityItem {
  readonly id: string;
  readonly at: string;
  readonly kind: string;
  readonly actorEmail: string | null;
  readonly subjectEmail: string | null;
  readonly detail: Record<string, unknown>;
}
interface Policy {
  readonly requireTwoStep: boolean;
  readonly codeStepAvailable: boolean;
  readonly activeStaff: number;
  readonly enrolledActiveStaff: number;
  readonly notEnrolled: readonly { principalExternalId: string; email: string }[];
  readonly pendingInvitations: number;
}

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
const staffLogin = (store: Store, email: string, password: string, target = app) =>
  publicPost("/public/auth/staff/login", store.tenantId, { email, password }, target);
const staffVerify = (tenant: string, challenge: string, code: string, target = app) =>
  publicPost("/public/auth/staff/login/verify", tenant, { challenge, code }, target);
const merchantLogin = (email: string, password: string) =>
  publicPost("/public/auth/merchant/login", PLATFORM, { email, password });
const merchantVerify = (tenant: string, challenge: string, code: string) =>
  publicPost("/public/auth/merchant/login/verify", tenant, { challenge, code });
const accept = (store: Store, token: string, password: string) =>
  publicPost("/public/auth/staff/invitations/accept", store.tenantId, { token, password });
const body = (res: LightMyRequestResponse) => res.json() as Record<string, unknown>;
const claimsOf = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
const uniqueEmail = (label: string, domain = "alpha.test") =>
  `${label}-${randomUUID().slice(0, 8)}@${domain}`;

async function signUpStore(storeName: string, email: string): Promise<Store> {
  const res = await publicPost("/public/merchant-signup", PLATFORM, {
    storeName,
    email,
    password: PASSWORD,
    country: "EG",
  });
  expect(res.statusCode).toBe(201);
  const out = res.json() as { tenantId: string; accessToken: string };
  return { tenantId: out.tenantId, token: out.accessToken, email };
}

/** Invite + read the emailed link + accept + sign in: a member created the product's way. */
async function onboard(store: Store, email: string, role: Role): Promise<Member> {
  const invited = await post(store.token, "/staff/invitations", { email, role });
  expect(invited.statusCode).toBe(201);
  const { invitationId, principalExternalId } = invited.json() as {
    invitationId: string;
    principalExternalId: string;
  };
  expect((await accept(store, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  const login = await staffLogin(store, email, NEW_PASSWORD);
  expect(login.statusCode).toBe(200);
  return {
    email,
    externalId: principalExternalId,
    invitationId,
    token: (login.json() as { accessToken: string }).accessToken,
  };
}

/** Turns two-step on for the holder of `token` (start, confirm with the code); returns the backup codes. */
async function enableTwoStep(token: string): Promise<string[]> {
  const started = await post(token, "/auth/staff/two-step/start", {});
  expect(started.statusCode).toBe(201);
  const confirmed = await post(token, "/auth/staff/two-step/confirm", {
    enrollmentId: body(started).enrollmentId,
    code: CODE,
  });
  expect(confirmed.statusCode).toBe(200);
  nextStep();
  return body(confirmed).backupCodes as string[];
}

/** Password step, then the code step: the member signed in the way an enrolled member does. */
async function signInWithCode(store: Store, email: string, password: string, code = CODE) {
  const first = await staffLogin(store, email, password);
  expect(first.statusCode).toBe(403);
  const challenge = body(first).challenge as string;
  nextStep();
  return { challenge, response: await staffVerify(store.tenantId, challenge, code) };
}

const tokenOf = (res: LightMyRequestResponse): string => body(res).accessToken as string;
const policyOf = async (token: string): Promise<Policy> => {
  const res = await get(token, "/staff/security-policy");
  expect(res.statusCode).toBe(200);
  return res.json() as Policy;
};
const activityOf = async (
  token: string,
  query = "",
): Promise<{
  items: ActivityItem[];
  nextCursor: string | null;
}> => {
  const res = await get(token, `/staff/activity${query}`);
  expect(res.statusCode).toBe(200);
  return res.json() as { items: ActivityItem[]; nextCursor: string | null };
};

beforeAll(async () => {
  h = await boot({ mfaConfigured: true });
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
});

describe("self-service two-step: /auth/staff/two-step", () => {
  it("every role may read its own status: off, no codes, policy not required", async () => {
    for (const token of [alpha.token, alphaAdmin.token, alphaOperator.token, alphaViewer.token]) {
      const res = await get(token, "/auth/staff/two-step");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        enabled: false,
        activatedAt: null,
        backupCodesLeft: 0,
        policyRequired: false,
        platformRequired: false,
      });
    }
  });

  it("start: 201 with the manual key and an otpauth link labelled with the EMAIL, never cached or replayed", async () => {
    const member = await onboard(alpha, uniqueEmail("start"), "viewer");
    const key = randomUUID();
    const first = await post(member.token, "/auth/staff/two-step/start", {}, key);
    expect(first.statusCode).toBe(201);
    expect(first.headers["cache-control"]).toContain("no-store");
    const out = body(first);
    expect(Object.keys(out).sort()).toEqual(["enrollmentId", "manualKey", "provisioningUri"]);
    expect(out.provisioningUri).toContain(
      `otpauth://totp/Morbeh:${encodeURIComponent(member.email)}`,
    );
    expect(out.provisioningUri).not.toContain(member.externalId);
    // The same Idempotency-Key must not replay the secret from a cache: a second setup is a new one.
    const second = await post(member.token, "/auth/staff/two-step/start", {}, key);
    expect(second.statusCode).toBe(201);
    expect(body(second).enrollmentId).not.toBe(out.enrollmentId);
    expect(second.headers["cache-control"]).toContain("no-store");
  });

  it("a second start while pending revokes the first: confirming the old id is 404", async () => {
    const member = await onboard(alpha, uniqueEmail("restart"), "operator");
    const one = body(await post(member.token, "/auth/staff/two-step/start", {}));
    const two = body(await post(member.token, "/auth/staff/two-step/start", {}));
    expect(two.enrollmentId).not.toBe(one.enrollmentId);
    const old = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: one.enrollmentId,
      code: CODE,
    });
    expect(old.statusCode).toBe(404);
    const current = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: two.enrollmentId,
      code: CODE,
    });
    expect(current.statusCode).toBe(200);
  });

  it("confirm: a wrong code is 409 and changes nothing; the right one returns 10 backup codes once, no-store", async () => {
    const member = await onboard(alpha, uniqueEmail("confirm"), "admin");
    const started = body(await post(member.token, "/auth/staff/two-step/start", {}));
    const wrong = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: started.enrollmentId,
      code: "000000",
    });
    expect(wrong.statusCode).toBe(409);
    expect(body(wrong).message).toBe("That code didn't work. Try again.");
    expect(body(await get(member.token, "/auth/staff/two-step").then((r) => r))).toMatchObject({
      enabled: false,
    });

    const right = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: started.enrollmentId,
      code: CODE,
    });
    expect(right.statusCode).toBe(200);
    expect(right.headers["cache-control"]).toContain("no-store");
    const codes = body(right).backupCodes as string[];
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(new Set(codes).size).toBe(10);
    const status = body(await get(member.token, "/auth/staff/two-step"));
    expect(status).toMatchObject({ enabled: true, backupCodesLeft: 10, policyRequired: false });
    expect(typeof status.activatedAt).toBe("string");
    // Starting again while on is refused.
    const again = await post(member.token, "/auth/staff/two-step/start", {});
    expect(again.statusCode).toBe(409);
    expect(body(again).message).toBe("Two-step verification is already on");
  });

  it("regenerate: a current code gives 10 NEW codes and the old backup codes stop working at sign-in", async () => {
    const member = await onboard(alpha, uniqueEmail("regen"), "operator");
    const original = await enableTwoStep(member.token);
    // A backup code is not proof for regenerating; a wrong code is refused.
    const wrong = await post(member.token, "/auth/staff/two-step/backup-codes", { code: "000000" });
    expect(wrong.statusCode).toBe(409);
    const fresh = await post(member.token, "/auth/staff/two-step/backup-codes", { code: CODE });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.headers["cache-control"]).toContain("no-store");
    const codes = body(fresh).backupCodes as string[];
    expect(codes).toHaveLength(10);
    expect(codes.filter((code) => original.includes(code))).toEqual([]);
    nextStep();
    const oldUse = await signInWithCode(alpha, member.email, NEW_PASSWORD, original[0]!);
    expect(oldUse.response.statusCode).toBe(401);
    expect(body(oldUse.response).error).toMatchObject({ code: "INVALID_CODE" });
    const newUse = await signInWithCode(alpha, member.email, NEW_PASSWORD, codes[0]!);
    expect(newUse.response.statusCode).toBe(200);
  });

  it("disable: a wrong password is 401 INVALID_PASSWORD and leaves two-step on and NO session behind", async () => {
    const member = await onboard(alpha, uniqueEmail("off"), "viewer");
    await enableTwoStep(member.token);
    const sessions = async () =>
      (
        await get(alpha.token, "/security/console/session-explorer").then(
          (r) => r.json() as { total?: number },
        )
      ).total;
    const before = await sessions();
    expect(typeof before).toBe("number");
    const wrong = await post(member.token, "/auth/staff/two-step/disable", { password: "not it" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({
      code: "INVALID_PASSWORD",
      message: "That password is incorrect",
    });
    expect(body(await get(member.token, "/auth/staff/two-step"))).toMatchObject({ enabled: true });
    expect(await sessions()).toBe(before);

    const right = await post(member.token, "/auth/staff/two-step/disable", {
      password: NEW_PASSWORD,
    });
    expect(right.statusCode).toBe(200);
    expect(await sessions()).toBe(before);
    expect(body(await get(member.token, "/auth/staff/two-step"))).toMatchObject({ enabled: false });
    // Off again: the password alone signs in.
    expect((await staffLogin(alpha, member.email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("changing the password keeps working for an enrolled member (no code asked, no new session)", async () => {
    const member = await onboard(alpha, uniqueEmail("pw"), "admin");
    await enableTwoStep(member.token);
    const changed = await post(member.token, "/auth/staff/password", {
      currentPassword: NEW_PASSWORD,
      newPassword: "another long password 2",
    });
    expect(changed.statusCode).toBe(200);
    const wrong = await post(member.token, "/auth/staff/password", {
      currentPassword: NEW_PASSWORD,
      newPassword: "another long password 3",
    });
    expect(wrong.statusCode).toBe(401);
    const signedIn = await signInWithCode(alpha, member.email, "another long password 2");
    expect(signedIn.response.statusCode).toBe(200);
  });

  it.each([
    ["operator", () => alphaOperator.token],
    ["viewer", () => alphaViewer.token],
    ["admin", () => alphaAdmin.token],
    ["owner", () => alpha.token],
  ])("%s runs the whole self-service cycle for themselves", async (_role, tokenOf) => {
    const token = tokenOf();
    const password = _role === "owner" ? PASSWORD : NEW_PASSWORD;
    const codes = await enableTwoStep(token);
    expect(codes).toHaveLength(10);
    expect(body(await get(token, "/auth/staff/two-step"))).toMatchObject({ enabled: true });
    const regenerated = await post(token, "/auth/staff/two-step/backup-codes", { code: CODE });
    expect(regenerated.statusCode).toBe(200);
    const disabled = await post(token, "/auth/staff/two-step/disable", { password });
    expect(disabled.statusCode).toBe(200);
    expect(body(await get(token, "/auth/staff/two-step"))).toMatchObject({ enabled: false });
    nextStep();
  });

  it("no route takes a person: unknown keys are 422, another member's enrolment id is 404, the caller is always the token", async () => {
    const mine = await onboard(alpha, uniqueEmail("mine"), "viewer");
    const theirs = await onboard(alpha, uniqueEmail("theirs"), "viewer");
    const startedTheirs = body(await post(theirs.token, "/auth/staff/two-step/start", {}));
    expect(
      (
        await post(mine.token, "/auth/staff/two-step/start", {
          principalExternalId: theirs.externalId,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post(mine.token, "/auth/staff/two-step/confirm", {
          enrollmentId: startedTheirs.enrollmentId,
          code: CODE,
          principalExternalId: theirs.externalId,
        })
      ).statusCode,
    ).toBe(422);
    const stolen = await post(mine.token, "/auth/staff/two-step/confirm", {
      enrollmentId: startedTheirs.enrollmentId,
      code: CODE,
    });
    expect(stolen.statusCode).toBe(404);
    // Their setup is untouched and still confirmable by them.
    const confirmed = await post(theirs.token, "/auth/staff/two-step/confirm", {
      enrollmentId: startedTheirs.enrollmentId,
      code: CODE,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(body(await get(mine.token, "/auth/staff/two-step"))).toMatchObject({ enabled: false });
    nextStep();
  });

  it("validates structure: a non-uuid enrolment id and an over-long code are 422; a missing token is 401", async () => {
    const member = await onboard(alpha, uniqueEmail("shape"), "viewer");
    const bad = [
      { enrollmentId: "nope", code: CODE },
      { enrollmentId: randomUUID(), code: "1".repeat(33) },
      { enrollmentId: randomUUID(), code: "" },
    ];
    for (const payload of bad) {
      expect((await post(member.token, "/auth/staff/two-step/confirm", payload)).statusCode).toBe(
        422,
      );
    }
    expect(
      (await post(member.token, "/auth/staff/two-step/disable", { password: "" })).statusCode,
    ).toBe(422);
    const anonymous = await app.inject({ method: "GET", url: `${API}/auth/staff/two-step` });
    expect(anonymous.statusCode).toBe(401);
  });

  it("confirm and new backup codes share one limiter bucket: six tries in ten minutes, the seventh is 429", async () => {
    const member = await onboard(alpha, uniqueEmail("limit"), "viewer");
    const started = body(await post(member.token, "/auth/staff/two-step/start", {}));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const wrong = await post(member.token, "/auth/staff/two-step/confirm", {
        enrollmentId: started.enrollmentId,
        code: "000000",
      });
      expect(wrong.statusCode).toBe(409);
    }
    const refused = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: started.enrollmentId,
      code: CODE,
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBeDefined();
    const regenerate = await post(member.token, "/auth/staff/two-step/backup-codes", {
      code: CODE,
    });
    expect(regenerate.statusCode).toBe(429);
    expect(
      limiter.calls.filter((call) => call.includes(`staff-mfa-confirm:${member.externalId}`))
        .length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      limiter.calls.some(
        (call) => call === `rl:${alpha.tenantId}:staff-mfa-confirm:${member.externalId}|6|600000`,
      ),
    ).toBe(true);
    // The window is the app clock's: ten minutes later the member can try again.
    clockState.offsetMs += 11 * 60 * 1000;
    const later = await post(member.token, "/auth/staff/two-step/confirm", {
      enrollmentId: started.enrollmentId,
      code: CODE,
    });
    expect(later.statusCode).toBe(200);
    nextStep();
  });

  it("starting is 503 NOT_CONFIGURED where the real TOTP provider is not configured", async () => {
    const bare = await boot({ mfaConfigured: false });
    try {
      const sent = bare.sender.sent;
      const owner = await (async () => {
        const res = await publicPost(
          "/public/merchant-signup",
          PLATFORM,
          {
            storeName: "Delta Store",
            email: "owner@delta.test",
            password: PASSWORD,
            country: "EG",
          },
          bare.app,
        );
        expect(res.statusCode).toBe(201);
        return (res.json() as { accessToken: string }).accessToken;
      })();
      const res = await post(owner, "/auth/staff/two-step/start", {}, randomUUID(), bare.app);
      expect(res.statusCode).toBe(503);
      expect(body(res).code).toBe("NOT_CONFIGURED");
      expect(JSON.stringify(res.json())).not.toContain("otpauth");
      expect(sent).toHaveLength(0);
      // The policy read says why it cannot be turned on.
      const policy = await get(owner, "/staff/security-policy", bare.app);
      expect(body(policy)).toMatchObject({ requireTwoStep: false, codeStepAvailable: false });
      const enable = await post(
        owner,
        "/staff/security-policy",
        { requireTwoStep: true },
        randomUUID(),
        bare.app,
      );
      expect(enable.statusCode).toBe(409);
      expect(body(enable).message).toBe("Two-step sign-in isn't available on this server yet");
    } finally {
      await bare.app.close();
    }
  });
});

describe("sign-in code step through the pipeline", () => {
  let member: Member;
  beforeAll(async () => {
    member = await onboard(alpha, uniqueEmail("flow"), "operator");
    await enableTwoStep(member.token);
  });

  it("an enrolled member's password alone gets a 403 with a challenge and NO token", async () => {
    const res = await staffLogin(alpha, member.email, NEW_PASSWORD);
    expect(res.statusCode).toBe(403);
    const out = body(res);
    expect(out.error).toEqual({
      code: "MFA_REQUIRED",
      message: "Enter the code from your authenticator app",
    });
    expect(typeof out.challenge).toBe("string");
    expect(out.challengeExpiresIn).toBe(300);
    expect(out.accessToken).toBeUndefined();
    const claims = claimsOf(out.challenge as string);
    expect(claims.sub).toBe(member.externalId);
    expect(claims.tenant_id).toBe(alpha.tenantId);
    expect(claims.kind).toBeUndefined();
    expect(claims.roles).toBeUndefined();
  });

  it("the right code is 200 with a staff token for exactly that member and store", async () => {
    const { response } = await signInWithCode(alpha, member.email, NEW_PASSWORD);
    expect(response.statusCode).toBe(200);
    const token = tokenOf(response);
    const claims = claimsOf(token);
    expect(claims.sub).toBe(member.externalId);
    expect(claims.tenant_id).toBe(alpha.tenantId);
    expect(claims.email).toBe(member.email);
    expect(claims.roles).toEqual(["operator"]);
    // The token is a working session: the member can read their own status with it.
    expect((await get(token, "/auth/staff/two-step")).statusCode).toBe(200);
    // …and it is the member's role, not more: operators never reach the staff list.
    expect((await get(token, "/staff")).statusCode).toBe(403);
  });

  it("a wrong code and a code from the wrong step answer one identical 401 INVALID_CODE", async () => {
    const wrong = await signInWithCode(alpha, member.email, NEW_PASSWORD, "000000");
    expect(wrong.response.statusCode).toBe(401);
    expect(wrong.response.json()).toEqual({
      error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
    });
    // The right code in the same step is spent by the first use; the second sign-in at that step fails alike.
    const first = await staffLogin(alpha, member.email, NEW_PASSWORD);
    const second = await staffLogin(alpha, member.email, NEW_PASSWORD);
    nextStep();
    expect(
      (await staffVerify(alpha.tenantId, body(first).challenge as string, CODE)).statusCode,
    ).toBe(200);
    const replay = await staffVerify(alpha.tenantId, body(second).challenge as string, CODE);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual(wrong.response.json());
  });

  it("a challenge finishes ONE sign-in: reusing it, even with a fresh valid code, is 401 CHALLENGE_EXPIRED", async () => {
    const first = await staffLogin(alpha, member.email, NEW_PASSWORD);
    const challenge = body(first).challenge as string;
    nextStep();
    expect((await staffVerify(alpha.tenantId, challenge, CODE)).statusCode).toBe(200);
    nextStep();
    const reused = await staffVerify(alpha.tenantId, challenge, CODE);
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toEqual({
      error: { code: "CHALLENGE_EXPIRED", message: "Your sign-in expired. Start again." },
    });
    expect(
      limiter.calls.some((call) => call.startsWith("rl:mfa-chal:") && call.endsWith("|1|600000")),
    ).toBe(true);
  });

  it("an expired challenge is 401 CHALLENGE_EXPIRED (not INVALID_CODE)", async () => {
    const first = await staffLogin(alpha, member.email, NEW_PASSWORD);
    clockState.offsetMs += 340_000;
    const res = await staffVerify(alpha.tenantId, body(first).challenge as string, CODE);
    expect(res.statusCode).toBe(401);
    expect(body(res).error).toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });

  it("garbage, a staff session token and a challenge of another kind are all CHALLENGE_EXPIRED", async () => {
    const session = await staffLogin(alpha, alphaViewer.email, NEW_PASSWORD);
    for (const challenge of ["garbage", tokenOf(session), alpha.token, "a.b.c"]) {
      const res = await staffVerify(alpha.tenantId, challenge, CODE);
      expect(res.statusCode).toBe(401);
      expect(body(res).error).toMatchObject({ code: "CHALLENGE_EXPIRED" });
    }
  });

  it("the challenge is not a Bearer token: GET /staff with it is 401", async () => {
    const first = await staffLogin(alpha, member.email, NEW_PASSWORD);
    const challenge = body(first).challenge as string;
    expect((await get(challenge, "/staff")).statusCode).toBe(401);
    expect((await get(challenge, "/auth/staff/two-step")).statusCode).toBe(401);
  });

  it("a staff challenge replayed on ANOTHER store's staff route is CHALLENGE_EXPIRED", async () => {
    // Earlier tests spent this member's ten-minute budget of code tries.
    clockState.offsetMs += 11 * 60 * 1000;
    const first = await staffLogin(alpha, member.email, NEW_PASSWORD);
    nextStep();
    const res = await staffVerify(beta.tenantId, body(first).challenge as string, CODE);
    expect(res.statusCode).toBe(401);
    expect(body(res).error).toMatchObject({ code: "CHALLENGE_EXPIRED" });
    // …and it did not burn the code: the right store still accepts it.
    expect(
      (await staffVerify(alpha.tenantId, body(first).challenge as string, CODE)).statusCode,
    ).toBe(200);
  });

  it("a member deactivated between the steps is refused with the uniform INVALID_CODE", async () => {
    const other = await onboard(alpha, uniqueEmail("gone"), "viewer");
    await enableTwoStep(other.token);
    const first = await staffLogin(alpha, other.email, NEW_PASSWORD);
    expect(
      (await post(alpha.token, `/staff/${other.externalId}/active`, { active: false })).statusCode,
    ).toBe(200);
    nextStep();
    const res = await staffVerify(alpha.tenantId, body(first).challenge as string, CODE);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
    });
  });

  it("limits the code step per member: the 7th try in ten minutes is 429 with retry-after, success counts too", async () => {
    const other = await onboard(alpha, uniqueEmail("brute"), "viewer");
    await enableTwoStep(other.token);
    const first = await staffLogin(alpha, other.email, NEW_PASSWORD);
    const challenge = body(first).challenge as string;
    nextStep();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const wrong = await staffVerify(alpha.tenantId, challenge, "000000");
      expect(wrong.statusCode).toBe(401);
    }
    const refused = await staffVerify(alpha.tenantId, challenge, CODE);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBeDefined();
    expect(refused.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(
      limiter.calls.filter(
        (call) => call === `rl:${alpha.tenantId}:staff-mfa:${other.externalId}|6|600000`,
      ),
    ).toHaveLength(7);
    // The right code was never looked at: still usable after the window.
    clockState.offsetMs += 11 * 60 * 1000;
    const fresh = await staffLogin(alpha, other.email, NEW_PASSWORD);
    nextStep();
    expect(
      (await staffVerify(alpha.tenantId, body(fresh).challenge as string, CODE)).statusCode,
    ).toBe(200);
  });

  it("fails CLOSED when the limiter is down: 429, and no session is made", async () => {
    const other = await onboard(alpha, uniqueEmail("down"), "viewer");
    await enableTwoStep(other.token);
    const first = await staffLogin(alpha, other.email, NEW_PASSWORD);
    nextStep();
    limiter.failWhen = (key) => key.includes("staff-mfa:");
    try {
      const res = await staffVerify(alpha.tenantId, body(first).challenge as string, CODE);
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(res.body).not.toContain("accessToken");
    } finally {
      limiter.failWhen = null;
    }
    expect(
      (await staffVerify(alpha.tenantId, body(first).challenge as string, CODE)).statusCode,
    ).toBe(200);
  });

  it("a backup code signs in once; the same backup code again is INVALID_CODE", async () => {
    const other = await onboard(alpha, uniqueEmail("backup"), "admin");
    const codes = await enableTwoStep(other.token);
    const first = await signInWithCode(alpha, other.email, NEW_PASSWORD, codes[0]!);
    expect(first.response.statusCode).toBe(200);
    const again = await signInWithCode(alpha, other.email, NEW_PASSWORD, codes[0]!);
    expect(again.response.statusCode).toBe(401);
    expect(body(again.response).error).toMatchObject({ code: "INVALID_CODE" });
    // Display form (upper case, no dashes) is the same code; another one works.
    const other2 = await signInWithCode(
      alpha,
      other.email,
      NEW_PASSWORD,
      codes[1]!.replace(/-/g, "").toUpperCase(),
    );
    expect(other2.response.statusCode).toBe(200);
  });

  it("verify bodies are strict (no extra keys, bounded sizes) and never idempotent", async () => {
    const tooLong = await staffVerify(alpha.tenantId, "c".repeat(4097), CODE);
    expect(tooLong.statusCode).toBe(422);
    const extra = await publicPost("/public/auth/staff/login/verify", alpha.tenantId, {
      challenge: "x",
      code: CODE,
      principalExternalId: "someone",
    });
    expect(extra.statusCode).toBe(422);
    expect((await staffVerify(alpha.tenantId, "x", "1".repeat(33))).statusCode).toBe(422);
  });
});

describe("merchant sign-in code step (multi-tenant harness)", () => {
  it("the merchant login of an enrolled owner is 403 + challenge; verify on the platform tenant gives the STORE's token", async () => {
    const store = await signUpStore("Merchant Store", "owner@merchant.test");
    await enableTwoStep(store.token);
    const first = await merchantLogin(store.email, PASSWORD);
    expect(first.statusCode).toBe(403);
    const out = body(first);
    expect(out.error).toMatchObject({ code: "MFA_REQUIRED" });
    expect(typeof out.challenge).toBe("string");
    expect(claimsOf(out.challenge as string).tenant_id).toBe(store.tenantId);
    nextStep();

    // The merchant verify route is a platform-tenant route: any other tenant header is refused.
    const wrongTenant = await merchantVerify(store.tenantId, out.challenge as string, CODE);
    expect(wrongTenant.statusCode).toBe(403);
    expect(body(wrongTenant).code).toBe("FORBIDDEN");

    const res = await merchantVerify(PLATFORM, out.challenge as string, CODE);
    expect(res.statusCode).toBe(200);
    const claims = claimsOf(tokenOf(res));
    expect(claims.tenant_id).toBe(store.tenantId);
    expect(claims.roles).toEqual(["admin"]);
    // The challenge is spent: the same challenge again is CHALLENGE_EXPIRED.
    nextStep();
    const reused = await merchantVerify(PLATFORM, out.challenge as string, CODE);
    expect(reused.statusCode).toBe(401);
    expect(body(reused).error).toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });

  it("a wrong code on the merchant route is the same uniform 401; a staff challenge from another store still works only for its own member", async () => {
    const store = await signUpStore("Merchant Two", "owner@merchant2.test");
    await enableTwoStep(store.token);
    const first = await merchantLogin(store.email, PASSWORD);
    nextStep();
    const wrong = await merchantVerify(PLATFORM, body(first).challenge as string, "000000");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({
      error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
    });
    const ok = await merchantVerify(PLATFORM, body(first).challenge as string, CODE);
    expect(ok.statusCode).toBe(200);
    expect(claimsOf(tokenOf(ok)).tenant_id).toBe(store.tenantId);
  });
});

describe("GET/POST /staff/security-policy", () => {
  let gamma: Store;
  let gammaAdmin: Member;
  let gammaOperator: Member;
  let gammaViewer: Member;
  let gammaOff: Member;

  beforeAll(async () => {
    gamma = await signUpStore("Gamma Store", "owner@gamma.test");
    gammaAdmin = await onboard(gamma, uniqueEmail("g-admin", "gamma.test"), "admin");
    gammaOperator = await onboard(gamma, uniqueEmail("g-op", "gamma.test"), "operator");
    gammaViewer = await onboard(gamma, uniqueEmail("g-view", "gamma.test"), "viewer");
    gammaOff = await onboard(gamma, uniqueEmail("g-off", "gamma.test"), "viewer");
    // Deactivated before the policy: never blocks it, and cannot be reactivated while it is on.
    expect(
      (await post(gamma.token, `/staff/${gammaOff.externalId}/active`, { active: false }))
        .statusCode,
    ).toBe(200);
  });

  it("operator and viewer are refused (403) on both routes and the activity read; an invited admin may read", async () => {
    for (const token of [gammaOperator.token, gammaViewer.token]) {
      expect((await get(token, "/staff/security-policy")).statusCode).toBe(403);
      expect(
        (await post(token, "/staff/security-policy", { requireTwoStep: true })).statusCode,
      ).toBe(403);
      expect((await get(token, "/staff/activity")).statusCode).toBe(403);
    }
    expect((await get(gammaAdmin.token, "/staff/security-policy")).statusCode).toBe(200);
    expect((await get(gammaAdmin.token, "/staff/activity")).statusCode).toBe(200);
  });

  it("GET: counts, who is missing, the capability flag, pending invitations", async () => {
    const policy = await policyOf(gamma.token);
    expect(policy).toMatchObject({
      requireTwoStep: false,
      codeStepAvailable: true,
      activeStaff: 4,
      enrolledActiveStaff: 0,
      pendingInvitations: 0,
    });
    expect(policy.notEnrolled.map((m) => m.email).sort()).toEqual(
      [gamma.email, gammaAdmin.email, gammaOperator.email, gammaViewer.email].sort(),
    );
    expect(JSON.stringify(policy)).not.toContain(gammaOff.email);
  });

  it("enabling is refused in order, with the exact messages, and writes nothing", async () => {
    const enable = () => post(gamma.token, "/staff/security-policy", { requireTwoStep: true });
    let res = await enable();
    expect(res.statusCode).toBe(409);
    expect(body(res).message).toBe("Turn on two-step verification for your own account first");

    await enableTwoStep(gamma.token);
    res = await enable();
    expect(res.statusCode).toBe(409);
    expect(body(res).message).toBe("Everyone needs two-step verification turned on first");

    await enableTwoStep(gammaAdmin.token);
    await enableTwoStep(gammaOperator.token);
    await enableTwoStep(gammaViewer.token);
    const pending = await post(gamma.token, "/staff/invitations", {
      email: uniqueEmail("pending", "gamma.test"),
      role: "viewer",
    });
    expect(pending.statusCode).toBe(201);
    res = await enable();
    expect(res.statusCode).toBe(409);
    expect(body(res).message).toBe("Revoke or wait for pending invitations first");
    expect((await policyOf(gamma.token)).requireTwoStep).toBe(false);
    expect(await policyOf(gamma.token)).toMatchObject({
      enrolledActiveStaff: 4,
      pendingInvitations: 1,
    });

    const revoked = await post(
      gamma.token,
      `/staff/invitations/${body(pending).invitationId as string}/revoke`,
      { expectedVersion: 1 },
    );
    expect(revoked.statusCode).toBe(200);
  });

  it("enabled when everyone has two-step; the rules then hold, and turning it off lifts them", async () => {
    const enabled = await post(gamma.token, "/staff/security-policy", { requireTwoStep: true });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ requireTwoStep: true });
    expect(await policyOf(gammaAdmin.token)).toMatchObject({ requireTwoStep: true });
    // The same value again is a quiet success.
    const again = await post(gamma.token, "/staff/security-policy", { requireTwoStep: true });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ requireTwoStep: true });
    expect(await policyOf(gamma.token)).toMatchObject({ requireTwoStep: true });

    const invite = await post(gamma.token, "/staff/invitations", {
      email: uniqueEmail("late", "gamma.test"),
      role: "viewer",
    });
    expect(invite.statusCode).toBe(409);
    expect(body(invite).message).toBe(
      "Your store requires two-step verification. Turn that off before inviting people",
    );
    const reactivate = await post(gamma.token, `/staff/${gammaOff.externalId}/active`, {
      active: true,
    });
    expect(reactivate.statusCode).toBe(409);
    expect(body(reactivate).message).toBe(
      "Your store requires two-step verification. Turn that off before reactivating people",
    );
    const ownOff = await post(gamma.token, "/auth/staff/two-step/disable", { password: PASSWORD });
    expect(ownOff.statusCode).toBe(409);
    expect(body(ownOff).message).toBe(
      "Your store requires two-step verification, so it can't be turned off",
    );
    expect(body(await get(gamma.token, "/auth/staff/two-step"))).toMatchObject({
      enabled: true,
      policyRequired: true,
    });
    // Everyone still signs in, with a code.
    const signedIn = await signInWithCode(gamma, gammaAdmin.email, NEW_PASSWORD);
    expect(signedIn.response.statusCode).toBe(200);

    // The invited admin turns it off (staff:set_policy is admin-level, not owner-only).
    const off = await post(gammaAdmin.token, "/staff/security-policy", { requireTwoStep: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ requireTwoStep: false });
    expect(
      (
        await post(gamma.token, "/staff/invitations", {
          email: uniqueEmail("late2", "gamma.test"),
          role: "viewer",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await post(gamma.token, `/staff/${gammaOff.externalId}/active`, { active: true }))
        .statusCode,
    ).toBe(200);
  });

  it("validates the body: a non-boolean or an extra key is 422", async () => {
    for (const payload of [{ requireTwoStep: "yes" }, {}, { requireTwoStep: true, extra: 1 }]) {
      expect((await post(gamma.token, "/staff/security-policy", payload)).statusCode).toBe(422);
    }
  });

  it("accepting an invitation while the store requires two-step is the uniform 410 and the member stays invited", async () => {
    const email = uniqueEmail("held", "gamma.test");
    const invited = await post(gamma.token, "/staff/invitations", { email, role: "viewer" });
    expect(invited.statusCode).toBe(201);
    // The policy flag as the older owner-only profile route sets it (the raced state the guard exists for).
    const flip = (mfaRequired: boolean) =>
      post(gamma.token, `/security/tenants/${gamma.tenantId}/security-profile`, { mfaRequired });
    expect((await flip(true)).statusCode).toBe(200);
    const held = await accept(gamma, sender.tokenFor(email), NEW_PASSWORD);
    expect(held.statusCode).toBe(410);
    expect(body(held).code).toBe("INVITATION_INVALID");
    const listed = await get(gamma.token, "/staff");
    const item = (listed.json() as { items: { email: string; status: string }[] }).items.find(
      (entry) => entry.email === email,
    );
    expect(item?.status).toBe("invited");
    expect((await flip(false)).statusCode).toBe(200);
    expect((await accept(gamma, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  });
});

describe("GET /staff/activity", () => {
  let delta: Store;
  let deltaOther: Store;
  let sam: Member;
  let samStart: number;

  beforeAll(async () => {
    delta = await signUpStore("Delta Store", "owner@delta-activity.test");
    deltaOther = await signUpStore("Delta Two", "owner@delta-two.test");
    samStart = clock.now().getTime();
    nextStep();
    sam = await onboard(delta, uniqueEmail("sam", "delta-activity.test"), "admin");
    nextStep();
    // A failed password, then two-step on, a failed code, a right code, a role change, new backup codes.
    expect((await staffLogin(delta, sam.email, "wrong password 1")).statusCode).toBe(401);
    nextStep();
    const codes = await enableTwoStep(sam.token);
    expect(codes).toHaveLength(10);
    nextStep();
    const failed = await signInWithCode(delta, sam.email, NEW_PASSWORD, "000000");
    expect(failed.response.statusCode).toBe(401);
    nextStep();
    const verified = await signInWithCode(delta, sam.email, NEW_PASSWORD);
    expect(verified.response.statusCode).toBe(200);
    nextStep();
    expect(
      (await post(delta.token, `/staff/${sam.externalId}/role`, { role: "viewer" })).statusCode,
    ).toBe(200);
    nextStep();
    // The old token's role no longer matches the live one (1d), so the member signs in again.
    const again = await signInWithCode(delta, sam.email, NEW_PASSWORD);
    expect(again.response.statusCode).toBe(200);
    nextStep();
    expect(
      (await post(tokenOf(again.response), "/auth/staff/two-step/backup-codes", { code: CODE }))
        .statusCode,
    ).toBe(200);
    nextStep();
    // The owner's own two-step and the policy toggle (everyone enrolled: sam, the owner).
    await enableTwoStep(delta.token);
    expect(
      (await post(delta.token, "/staff/security-policy", { requireTwoStep: true })).statusCode,
    ).toBe(200);
  });

  it("shows the scripted sequence for one member, newest first, with emails and no secrets", async () => {
    const { items } = await activityOf(delta.token, `?member=${sam.externalId}`);
    expect(items.map((item) => item.kind)).toEqual([
      "backup_codes_regenerated",
      "signed_in",
      "role_changed",
      "signed_in",
      "code_failed",
      "two_step_on",
      "sign_in_failed",
      "signed_in",
      "invitation_accepted",
      "invited",
    ]);
    const times = items.map((item) => item.at);
    expect([...times].sort().reverse()).toEqual(times);
    for (const item of items) {
      expect(item.subjectEmail).toBe(sam.email);
      expect(Object.keys(item).sort()).toEqual([
        "actorEmail",
        "at",
        "detail",
        "id",
        "kind",
        "subjectEmail",
      ]);
    }
    const roleChange = items.find((item) => item.kind === "role_changed");
    expect(roleChange).toMatchObject({
      actorEmail: delta.email,
      detail: { from: "admin", to: "viewer" },
    });
    const invited = items.find((item) => item.kind === "invited");
    expect(invited).toMatchObject({ actorEmail: delta.email, detail: { to: "admin" } });
    const serialized = JSON.stringify(items);
    for (const secret of [NEW_PASSWORD, CODE, "otpauth", "challenge", "hash"]) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(Date.parse(items.at(-1)?.at ?? "")).toBeGreaterThanOrEqual(samStart);
  });

  it("without a member filter the policy toggle is the newest row, and the whole store is covered", async () => {
    const { items, nextCursor } = await activityOf(delta.token);
    expect(nextCursor).toBeNull();
    expect(items[0]).toMatchObject({
      kind: "two_step_policy_changed",
      actorEmail: delta.email,
      detail: { enabled: true },
    });
    const kinds = new Set(items.map((item) => item.kind));
    for (const kind of [
      "invited",
      "invitation_accepted",
      "signed_in",
      "code_failed",
      "two_step_on",
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("pages with an opaque cursor: no overlap, no gap, the same rows as the unpaged list", async () => {
    const whole = await activityOf(delta.token);
    const seen: ActivityItem[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=4${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const page: { items: ActivityItem[]; nextCursor: string | null } = await activityOf(
        delta.token,
        query,
      );
      expect(page.items.length).toBeLessThanOrEqual(4);
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);
    expect(pages).toBeGreaterThan(1);
    expect(seen.map((item) => item.id)).toEqual(whole.items.map((item) => item.id));
    expect(new Set(seen.map((item) => item.id)).size).toBe(seen.length);
  });

  it("validates the query: limit 1..50, member and cursor shape; a forged cursor is 422 on cursor", async () => {
    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=abc",
      "?member=",
      `?member=${"m".repeat(201)}`,
    ]) {
      expect((await get(delta.token, `/staff/activity${query}`)).statusCode).toBe(422);
    }
    const forged = await get(delta.token, "/staff/activity?cursor=not-a-cursor");
    expect(forged.statusCode).toBe(422);
    expect(JSON.stringify(body(forged).fields)).toContain("cursor");
  });

  it("is tenant-scoped: another store sees none of it, and asking for this store's member shows nothing", async () => {
    const other = await activityOf(deltaOther.token);
    expect(JSON.stringify(other.items)).not.toContain(sam.email);
    expect(JSON.stringify(other.items)).not.toContain(delta.email);
    const probing = await activityOf(deltaOther.token, `?member=${sam.externalId}`);
    expect(probing.items).toEqual([]);
  });

  it("operator and viewer are refused (403)", async () => {
    expect((await get(alphaOperator.token, "/staff/activity")).statusCode).toBe(403);
    expect((await get(alphaViewer.token, "/staff/activity")).statusCode).toBe(403);
    expect((await get(alphaAdmin.token, "/staff/activity")).statusCode).toBe(200);
  });
});
