import { generateKeyPairSync } from "node:crypto";
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
