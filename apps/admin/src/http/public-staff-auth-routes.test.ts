import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, RateLimiter } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { JwtVerifier, NativeTokenIssuer, localKeyResolver } from "@platform/auth";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { staffIdentifier } from "../interfaces/staff-auth.admin-controller";
import { publicStaffAuthRoutes } from "./public-staff-auth-routes";

const clock: Clock = { now: () => new Date() };
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

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

function issuer() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
  });
}

async function setup(withIssuer = true, rateLimiter?: RateLimiter) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const native = issuer();
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    ...(withIssuer ? { staffTokenIssuer: native } : {}),
  });
  return { admin, native, routes: publicStaffAuthRoutes(admin, rateLimiter) };
}

/** Seeds a staff member straight through Security, the way the owner bootstrap (Task 6) will. */
async function seedStaff(admin: WiredAdmin, roleKey: string | null) {
  const tenantId = "tenant-local";
  admin.securityWiring.identityDirectory.register("staff-1");
  await admin.securityWiring.security.registerPrincipal({
    tenantId,
    externalId: "staff-1",
    kind: "human",
    displayName: "owner@example.test",
    subjectRef: "staff-1",
  });
  await admin.securityWiring.passwordRegistrar.setPassword({
    tenantId,
    identifier: staffIdentifier("owner@example.test"),
    password: "fake-password-1",
    principalExternalId: "staff-1",
  });
  if (roleKey !== null) {
    await admin.securityWiring.security.defineRole({
      tenantId,
      key: roleKey,
      name: roleKey,
      permissions: ["*:*"],
    });
    await admin.securityWiring.security.assignRole({
      tenantId,
      principalExternalId: "staff-1",
      roleKey,
      grantedBy: "test",
    });
  }
}

const find = (routes: readonly RouteDefinition[], method: string, path: string) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
};
const call = (r: RouteDefinition, body?: unknown) =>
  r.handle({
    body,
    params: {},
    query: {},
    context: {
      tenantId: "tenant-local",
      principal: { id: "anonymous", kind: "customer", roles: [], tenantId: "tenant-local" },
      requestId: "r",
    },
  } as never) as Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;

describe("staff sign-in (Plan 1B-2)", () => {
  it("an owner signs in and gets a token the runtime's verifier accepts as an admin of this shop", async () => {
    const { admin, native, routes } = await setup();
    await seedStaff(admin, "platform-admin");
    const res = await call(find(routes, "POST", "/public/auth/staff/login"), {
      email: "Owner@Example.test",
      password: "fake-password-1",
    });
    expect(res.status).toBe(200);
    const body = res.body as { accessToken: string; tokenType: string; expiresIn: number };
    expect(body.tokenType).toBe("Bearer");
    const verifier = new JwtVerifier({
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: silent,
    });
    const ctx = await verifier.verifyWithClaims(body.accessToken);
    expect(ctx?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(ctx?.claims["tenant_id"]).toBe("tenant-local");
  });

  it("wrong password → 401; a principal with no staff role → 401", async () => {
    const { admin, routes } = await setup();
    await seedStaff(admin, null);
    const login = find(routes, "POST", "/public/auth/staff/login");
    expect(
      (await call(login, { email: "owner@example.test", password: "wrong-password" })).status,
    ).toBe(401);
    expect(
      (await call(login, { email: "owner@example.test", password: "fake-password-1" })).status,
    ).toBe(401);
  });

  it("a customer's credentials never work on the staff login (separate identifier namespace)", async () => {
    const { admin, routes } = await setup();
    await admin.securityWiring.passwordRegistrar.setPassword({
      tenantId: "tenant-local",
      identifier: "owner@example.test",
      password: "fake-password-1",
      principalExternalId: "customer-1",
    });
    const res = await call(find(routes, "POST", "/public/auth/staff/login"), {
      email: "owner@example.test",
      password: "fake-password-1",
    });
    expect(res.status).toBe(401);
  });

  it("JWKS publishes the public key; with no issuer configured both routes answer 503", async () => {
    const { routes } = await setup();
    const jwks = await call(find(routes, "GET", "/public/auth/jwks"));
    expect((jwks.body as { keys: unknown[] }).keys).toHaveLength(1);
    const off = await setup(false);
    expect((await call(find(off.routes, "GET", "/public/auth/jwks"))).status).toBe(503);
    expect(
      (
        await call(find(off.routes, "POST", "/public/auth/staff/login"), {
          email: "a@b.c",
          password: "fake-password-1",
        })
      ).status,
    ).toBe(503);
  });

  it("the 11th attempt in the window is refused even with the right password, and email case does not dodge the bucket", async () => {
    const limiter = new CountingRateLimiter();
    const { admin, routes } = await setup(true, limiter);
    await seedStaff(admin, "platform-admin");
    const login = find(routes, "POST", "/public/auth/staff/login");
    // Ten successful sign-ins: each one resets the 1B-1 lockout, so only the route limiter can refuse the 11th.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ok = await call(login, { email: " Owner@Example.test ", password: "fake-password-1" });
      expect(ok.status).toBe(200);
    }
    const refused = await call(login, { email: "owner@example.test", password: "fake-password-1" });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: "RATE_LIMITED", retryable: true, fields: [] });
    expect(refused.headers?.["retry-after"]).toBeDefined();
    const recased = await call(login, { email: "OWNER@EXAMPLE.TEST", password: "fake-password-1" });
    expect(recased.status).toBe(429);
    expect(new Set(limiter.keys)).toEqual(
      new Set(["rl:tenant-local:staff-login:owner@example.test|10|900000"]),
    );
    // Another address has its own bucket, and the limiter never says whether the account exists.
    const other = await call(login, { email: "nobody@example.test", password: "fake-password-1" });
    expect(other.status).toBe(401);
  });
});

const INVITE_ACCEPT = "/public/auth/staff/invitations/accept";

describe("staff invitation accept route (Wave 1d)", () => {
  it("is public, authenticated by the link alone, and NOT idempotent", async () => {
    const { routes } = await setup();
    const route = find(routes, "POST", INVITE_ACCEPT);
    expect(route.public).toBe(true);
    expect(route.permission).toBe("security:authenticate");
    expect(route.idempotent).not.toBe(true);
  });

  it("checks structure only: token 1..512, password at most 256, no unknown keys (a short password is Security's 422)", async () => {
    const { routes } = await setup();
    const schema = find(routes, "POST", INVITE_ACCEPT).schema.body!;
    expect(schema.safeParse({ token: "t", password: "short" }).success).toBe(true);
    expect(schema.safeParse({ token: "", password: "x" }).success).toBe(false);
    expect(schema.safeParse({ token: "t".repeat(513), password: "x" }).success).toBe(false);
    expect(schema.safeParse({ token: "t", password: "p".repeat(257) }).success).toBe(false);
    expect(schema.safeParse({ token: "t", password: "x", store: "s" }).success).toBe(false);
  });

  it("answers the uniform 410 for any unknown link and a 422 on field password for a weak one", async () => {
    const { routes } = await setup();
    const route = find(routes, "POST", INVITE_ACCEPT);
    const gone = await call(route, { token: "nope", password: "a-long-enough-password" });
    expect(gone.status).toBe(410);
    expect(gone.body).toMatchObject({
      code: "INVITATION_INVALID",
      message: "This invitation link is invalid or has expired",
    });
    const weak = await call(route, { token: "nope", password: "short" });
    expect(weak.status).toBe(422);
    expect(JSON.stringify((weak.body as { fields: unknown }).fields)).toContain("password");
  });

  it("is limited to 10 per 15 minutes per token HASH: the bucket carries a sha256, never the token", async () => {
    const limiter = new CountingRateLimiter();
    const { routes } = await setup(true, limiter);
    const route = find(routes, "POST", INVITE_ACCEPT);
    const token = "secret-invitation-token-value";
    for (let i = 0; i < 10; i += 1) {
      expect((await call(route, { token, password: "a-long-enough-password" })).status).toBe(410);
    }
    const refused = await call(route, { token, password: "a-long-enough-password" });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(refused.headers?.["retry-after"]).toBeDefined();
    const hash = createHash("sha256").update(token).digest("hex");
    expect(new Set(limiter.keys)).toEqual(
      new Set([`rl:tenant-local:staff-invite-accept:${hash}|10|900000`]),
    );
    expect(limiter.keys.join("\n")).not.toContain(token);
    // Another token has its own bucket.
    expect(
      (await call(route, { token: "another", password: "a-long-enough-password" })).status,
    ).toBe(410);
  });
});

const VERIFY = "/public/auth/staff/login/verify";
const TENANT = "tenant-local";
const CODE = "123456";
const STEP_MS = 31_000;

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const callIn = (r: RouteDefinition, body: unknown, tenantId: string): Promise<Reply> => {
  const parsed = r.schema.body?.safeParse(body);
  if (parsed !== undefined && !parsed.success) {
    return Promise.resolve({ status: 422, body: { code: "VALIDATION" } });
  }
  return r.handle({
    body: parsed === undefined ? body : parsed.data,
    params: {},
    query: {},
    context: {
      tenantId,
      principal: { id: "anonymous", kind: "customer", roles: [], tenantId },
      requestId: "r",
    },
  } as never) as Promise<Reply>;
};

/**
 * Wave 1e: the code step, in-process (route handlers called directly). The clock is ours: moving it a
 * TOTP step on is what makes a second use of the in-memory provider's "123456" valid. The HTTP-pipeline
 * twin is `two-step-routes.test.ts`.
 */
async function setupCodeStep(rateLimiter?: RateLimiter) {
  const state = { ms: Date.now() };
  const fake: Clock = { now: () => new Date(state.ms) };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const native = new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
    now: () => fake.now(),
  });
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock: fake,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock: fake,
    }),
    staffTokenIssuer: native,
    mfaConfigured: true,
  });
  await seedStaff(admin, "platform-admin");
  const routes = publicStaffAuthRoutes(admin, rateLimiter);
  const security = admin.securityWiring.security;
  const sessions = async () => (await security.sessionExplorer(TENANT)).total;
  const enrol = async (): Promise<string[]> => {
    const started = await security.startOwnTwoStep({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      email: "owner@example.test",
    });
    expect(started.status).toBe(201);
    const confirmed = await security.confirmOwnTwoStep({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      enrollmentId: (started.body as { enrollmentId: string }).enrollmentId,
      code: CODE,
      now: fake.now(),
    });
    expect(confirmed.status).toBe(200);
    state.ms += STEP_MS;
    return (confirmed.body as { backupCodes: string[] }).backupCodes;
  };
  const login = () =>
    call(find(routes, "POST", "/public/auth/staff/login"), {
      email: "owner@example.test",
      password: "fake-password-1",
    });
  const verify = (challenge: string, code: string, tenantId = TENANT) =>
    callIn(find(routes, "POST", VERIFY), { challenge, code }, tenantId);
  const challengeOf = async (): Promise<string> => {
    const res = await login();
    expect(res.status).toBe(403);
    return (res.body as { challenge: string }).challenge;
  };
  const next = (): void => {
    state.ms += STEP_MS;
  };
  return { admin, native, routes, state, sessions, enrol, login, verify, challengeOf, next };
}

const INVALID_CODE_BODY = {
  error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
};
const CHALLENGE_EXPIRED_BODY = {
  error: { code: "CHALLENGE_EXPIRED", message: "Your sign-in expired. Start again." },
};

describe("staff sign-in code step (Wave 1e)", () => {
  it("an unenrolled member signs in with the password alone (no challenge involved)", async () => {
    const { login, sessions } = await setupCodeStep();
    const res = await login();
    expect(res.status).toBe(200);
    expect((res.body as { accessToken?: string }).accessToken).toBeDefined();
    expect(await sessions()).toBe(1);
  });

  it("an enrolled member's password alone is 403 MFA_REQUIRED with a challenge, no token and no session", async () => {
    const { enrol, login, sessions, native } = await setupCodeStep();
    await enrol();
    const res = await login();
    expect(res.status).toBe(403);
    const out = res.body as {
      error: { code: string; message: string };
      challenge: string;
      challengeExpiresIn: number;
      accessToken?: string;
    };
    expect(out.error).toEqual({
      code: "MFA_REQUIRED",
      message: "Enter the code from your authenticator app",
    });
    expect(out.challengeExpiresIn).toBe(300);
    expect(out.accessToken).toBeUndefined();
    expect(await native.verifyChallenge(out.challenge)).toMatchObject({
      sub: "staff-1",
      tenantId: TENANT,
      email: "owner@example.test",
    });
    expect(await sessions()).toBe(0);
  });

  it("the verify route is public, not idempotent, and strict about its body", async () => {
    const { routes } = await setupCodeStep();
    const route = find(routes, "POST", VERIFY);
    expect(route.public).toBe(true);
    expect(route.permission).toBe("security:authenticate");
    expect(route.idempotent).not.toBe(true);
    const schema = route.schema.body!;
    expect(schema.safeParse({ challenge: "c", code: "1" }).success).toBe(true);
    expect(schema.safeParse({ challenge: "", code: "1" }).success).toBe(false);
    expect(schema.safeParse({ challenge: "c".repeat(4097), code: "1" }).success).toBe(false);
    expect(schema.safeParse({ challenge: "c", code: "" }).success).toBe(false);
    expect(schema.safeParse({ challenge: "c", code: "1".repeat(33) }).success).toBe(false);
    expect(schema.safeParse({ challenge: "c", code: "1", extra: true }).success).toBe(false);
  });

  it("the right code is 200 with a token whose sub is the member; the token verifies as an admin", async () => {
    const { enrol, challengeOf, verify, native } = await setupCodeStep();
    await enrol();
    const res = await verify(await challengeOf(), CODE);
    expect(res.status).toBe(200);
    const verifier = new JwtVerifier({
      issuer: "https://api.test/",
      audience: "morbeh-admin",
      getKey: await localKeyResolver(native),
      logger: silent,
    });
    const ctx = await verifier.verifyWithClaims((res.body as { accessToken: string }).accessToken);
    expect(ctx?.principal).toEqual({ id: "staff-1", kind: "staff", roles: ["admin"] });
    expect(ctx?.claims["tenant_id"]).toBe(TENANT);
  });

  it("a wrong code, a reused step and an unknown member answer the SAME 401 INVALID_CODE", async () => {
    const { enrol, challengeOf, verify, native, sessions } = await setupCodeStep();
    await enrol();
    const first = await challengeOf();
    const second = await challengeOf();
    const wrong = await verify(first, "000000");
    expect(wrong).toEqual({ status: 401, body: INVALID_CODE_BODY });
    expect((await verify(first, CODE)).status).toBe(200);
    // Same step again, with another challenge: the step is spent.
    expect(await verify(second, CODE)).toEqual(wrong);
    const stranger = await native.issueChallenge({
      sub: "nobody",
      tenantId: TENANT,
      email: "nobody@example.test",
    });
    expect(await verify(stranger.token, CODE)).toEqual(wrong);
    expect(await sessions()).toBe(1);
  });

  it("a backup code signs in once; the same code again is INVALID_CODE", async () => {
    const { enrol, challengeOf, verify, next } = await setupCodeStep();
    const codes = await enrol();
    expect((await verify(await challengeOf(), codes[0]!)).status).toBe(200);
    next();
    expect(await verify(await challengeOf(), codes[0]!)).toEqual({
      status: 401,
      body: INVALID_CODE_BODY,
    });
  });

  it("a challenge finishes one sign-in: the second use, even with a fresh code, is CHALLENGE_EXPIRED", async () => {
    const limiter = new CountingRateLimiter();
    const { enrol, challengeOf, verify, next, sessions } = await setupCodeStep(limiter);
    await enrol();
    const challenge = await challengeOf();
    expect((await verify(challenge, CODE)).status).toBe(200);
    next();
    expect(await verify(challenge, CODE)).toEqual({ status: 401, body: CHALLENGE_EXPIRED_BODY });
    expect(await sessions()).toBe(1);
    expect(limiter.keys.some((key) => /^rl:mfa-chal:[0-9a-f-]{36}\|1\|600000$/.test(key))).toBe(
      true,
    );
  });

  it("an expired challenge and garbage are CHALLENGE_EXPIRED", async () => {
    const { enrol, challengeOf, verify, state } = await setupCodeStep();
    await enrol();
    const challenge = await challengeOf();
    expect(await verify("garbage", CODE)).toEqual({ status: 401, body: CHALLENGE_EXPIRED_BODY });
    state.ms += 340_000;
    expect(await verify(challenge, CODE)).toEqual({ status: 401, body: CHALLENGE_EXPIRED_BODY });
  });

  it("a staff session token passed as the challenge is CHALLENGE_EXPIRED", async () => {
    const { admin, verify } = await setupCodeStep();
    // A second, unenrolled member signs in for a real session token.
    admin.securityWiring.identityDirectory.register("staff-2");
    await admin.securityWiring.security.registerPrincipal({
      tenantId: TENANT,
      externalId: "staff-2",
      kind: "human",
      displayName: "two@example.test",
      subjectRef: "staff-2",
    });
    await admin.securityWiring.passwordRegistrar.setPassword({
      tenantId: TENANT,
      identifier: staffIdentifier("two@example.test"),
      password: "fake-password-2",
      principalExternalId: "staff-2",
    });
    await admin.securityWiring.security.assignRole({
      tenantId: TENANT,
      principalExternalId: "staff-2",
      roleKey: "platform-admin",
      grantedBy: "test",
    });
    const session = await admin.staffAuth.login({
      tenantId: TENANT,
      email: "two@example.test",
      password: "fake-password-2",
    });
    expect(session.status).toBe(200);
    const token = (session.body as { accessToken: string }).accessToken;
    expect(await verify(token, CODE)).toEqual({ status: 401, body: CHALLENGE_EXPIRED_BODY });
  });

  it("a challenge replayed on another tenant's route is CHALLENGE_EXPIRED and spends nothing", async () => {
    const limiter = new CountingRateLimiter();
    const { enrol, challengeOf, verify } = await setupCodeStep(limiter);
    await enrol();
    const challenge = await challengeOf();
    const before = limiter.keys.length;
    expect(await verify(challenge, CODE, "another-tenant")).toEqual({
      status: 401,
      body: CHALLENGE_EXPIRED_BODY,
    });
    expect(limiter.keys).toHaveLength(before);
    expect((await verify(challenge, CODE)).status).toBe(200);
  });

  it("limits 6 per member per 10 minutes (success counts): the 7th is 429 with retry-after; keys carry no code", async () => {
    const limiter = new CountingRateLimiter();
    const { enrol, challengeOf, verify } = await setupCodeStep(limiter);
    await enrol();
    const challenge = await challengeOf();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await verify(challenge, "000000")).status).toBe(401);
    }
    const refused = await verify(challenge, CODE);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(refused.headers?.["retry-after"]).toBeDefined();
    expect(new Set(limiter.keys.filter((key) => key.includes("staff-mfa")))).toEqual(
      new Set([`rl:${TENANT}:staff-mfa:staff-1|6|600000`]),
    );
    expect(limiter.keys.join("\n")).not.toContain(CODE);
    expect(limiter.keys.join("\n")).not.toContain(challenge);
  });

  it("fails CLOSED: a limiter that throws is 429, before the code is checked and again at the burn, and no session is made", async () => {
    let failOn: string | null = "staff-mfa:";
    const flaky: RateLimiter = {
      consume: (key, limit) =>
        failOn !== null && key.includes(failOn)
          ? Promise.reject(new Error("redis down"))
          : Promise.resolve({ allowed: true, remaining: limit, retryAfterMs: 0 }),
    };
    const { enrol, challengeOf, verify, sessions } = await setupCodeStep(flaky);
    await enrol();
    const challenge = await challengeOf();
    const first = await verify(challenge, CODE);
    expect(first.status).toBe(429);
    expect(first.headers?.["retry-after"]).toBeDefined();
    // Down at the attempt counter: the code was never looked at, so it is still good. Now fail the burn.
    failOn = "mfa-chal:";
    const second = await verify(challenge, CODE);
    expect(second.status).toBe(429);
    expect(await sessions()).toBe(0);
    // The code was checked (and spent) before the burn failed: it is not accepted a second time.
    failOn = null;
    expect((await verify(challenge, CODE)).status).toBe(401);
  });

  it("without a limiter (tests) there is no limit and no burn; with no issuer every challenge is CHALLENGE_EXPIRED", async () => {
    const { enrol, challengeOf, verify } = await setupCodeStep();
    await enrol();
    expect((await verify(await challengeOf(), CODE)).status).toBe(200);
    const off = await setup(false);
    const res = await callIn(
      find(off.routes, "POST", VERIFY),
      { challenge: "x", code: CODE },
      TENANT,
    );
    expect(res).toEqual({ status: 401, body: CHALLENGE_EXPIRED_BODY });
  });

  it("change-password keeps working for an enrolled member and makes no session", async () => {
    const { admin, enrol, sessions, login } = await setupCodeStep();
    await enrol();
    expect((await login()).status).toBe(403);
    const changed = await admin.staffAuth.changePassword({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      currentPassword: "fake-password-1",
      newPassword: "a brand new password 1",
    });
    expect(changed.status).toBe(200);
    const stale = await admin.staffAuth.changePassword({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      currentPassword: "fake-password-1",
      newPassword: "another new password 2",
    });
    expect(stale.status).toBe(401);
    expect(await sessions()).toBe(0);
  });

  it("disable: a wrong password is 401 INVALID_PASSWORD with no session; the right one turns it off", async () => {
    const { admin, enrol, sessions, login } = await setupCodeStep();
    await enrol();
    const wrong = await admin.staffAuth.disableTwoStep({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      password: "not it",
    });
    expect(wrong).toEqual({
      status: 401,
      body: { code: "INVALID_PASSWORD", message: "That password is incorrect" },
    });
    expect(await sessions()).toBe(0);
    const right = await admin.staffAuth.disableTwoStep({
      tenantId: TENANT,
      principalExternalId: "staff-1",
      password: "fake-password-1",
    });
    expect(right.status).toBe(200);
    expect(await sessions()).toBe(0);
    expect((await login()).status).toBe(200);
  });
});
