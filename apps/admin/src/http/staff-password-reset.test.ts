import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, RateLimiter } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { NativeTokenIssuer } from "@platform/auth";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
  type PasswordResetTokenStore,
} from "@platform/security";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { staffIdentifier } from "../interfaces/staff-auth.admin-controller";
import { publicStaffAuthRoutes } from "./public-staff-auth-routes";
import { staffAccountRoutes } from "./staff-account-routes";

const clock: Clock = { now: () => new Date() };
const TENANT = "tenant-local";

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
const tokenFrom = (text: string) => /https?:\/\/\S+token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

function setup(rateLimiter?: RateLimiter, passwordResetTokens?: PasswordResetTokenStore) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sender = new RecordingSender();
  const admin: WiredAdmin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
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
    ...(passwordResetTokens === undefined ? {} : { passwordResetTokens }),
  });
  return {
    admin,
    sender,
    publicRoutes: publicStaffAuthRoutes(admin, rateLimiter),
    accountRoutes: staffAccountRoutes(admin),
  };
}

async function seedStaff(admin: WiredAdmin, roleKey: string) {
  admin.securityWiring.identityDirectory.register("staff-1");
  await admin.securityWiring.security.registerPrincipal({
    tenantId: TENANT,
    externalId: "staff-1",
    kind: "human",
    displayName: "owner@example.test",
    subjectRef: "staff-1",
  });
  await admin.securityWiring.passwordRegistrar.setPassword({
    tenantId: TENANT,
    identifier: staffIdentifier("owner@example.test"),
    password: "fake-password-1",
    principalExternalId: "staff-1",
  });
  await admin.securityWiring.security.defineRole({
    tenantId: TENANT,
    key: roleKey,
    name: roleKey,
    permissions: ["*:*"],
  });
  await admin.securityWiring.security.assignRole({
    tenantId: TENANT,
    principalExternalId: "staff-1",
    roleKey,
    grantedBy: "test",
  });
}

const find = (routes: readonly RouteDefinition[], method: string, path: string) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`no route ${method} ${path}`);
  return r;
};
const call = (
  r: RouteDefinition,
  body?: unknown,
  principal: { id: string; kind: string; roles: string[]; tenantId: string } = {
    id: "anonymous",
    kind: "customer",
    roles: [],
    tenantId: TENANT,
  },
) =>
  r.handle({
    body,
    params: {},
    query: {},
    context: { tenantId: TENANT, principal, requestId: "r" },
  } as never) as Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;

const REQUEST = "/public/auth/staff/password-reset/request";
const COMPLETE = "/public/auth/staff/password-reset/complete";
const LOGIN = "/public/auth/staff/login";

describe("staff password reset and change (Plan 1C)", () => {
  it("request → email with link → complete → sign in with the new password; old one fails", async () => {
    const { admin, sender, publicRoutes } = setup();
    await seedStaff(admin, "platform-admin");
    const requested = await call(find(publicRoutes, "POST", REQUEST), {
      email: "Owner@Example.test",
    });
    expect(requested.status).toBe(202);
    expect(requested.body).toEqual({ outcome: "sent-if-exists" });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("owner@example.test");
    expect(sender.sent[0]?.text).toContain("https://admin.test/reset-password?token=");
    const token = tokenFrom(sender.sent[0]?.text ?? "");
    expect(token).not.toBe("");

    const done = await call(find(publicRoutes, "POST", COMPLETE), {
      token,
      password: "brand-new-pass-1",
    });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ outcome: "reset" });

    const login = find(publicRoutes, "POST", LOGIN);
    expect(
      (await call(login, { email: "owner@example.test", password: "brand-new-pass-1" })).status,
    ).toBe(200);
    expect(
      (await call(login, { email: "owner@example.test", password: "fake-password-1" })).status,
    ).toBe(401);

    const replay = await call(find(publicRoutes, "POST", COMPLETE), {
      token,
      password: "another-new-pass-1",
    });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: { code: "INVALID_TOKEN" } });
  });

  it("a weak new password is 422 and the link still works afterwards", async () => {
    const { admin, sender, publicRoutes } = setup();
    await seedStaff(admin, "platform-admin");
    await call(find(publicRoutes, "POST", REQUEST), { email: "owner@example.test" });
    const token = tokenFrom(sender.sent[0]?.text ?? "");
    const weak = await call(find(publicRoutes, "POST", COMPLETE), { token, password: "short" });
    expect(weak.status).toBe(422);
    const ok = await call(find(publicRoutes, "POST", COMPLETE), {
      token,
      password: "good-password-1",
    });
    expect(ok.status).toBe(200);
  });

  it("an unknown email gets the identical 202 and no email is sent", async () => {
    const { admin, sender, publicRoutes } = setup();
    await seedStaff(admin, "platform-admin");
    const hit = await call(find(publicRoutes, "POST", REQUEST), { email: "owner@example.test" });
    const miss = await call(find(publicRoutes, "POST", REQUEST), { email: "nobody@example.test" });
    expect(miss.status).toBe(202);
    expect(miss.status).toBe(hit.status);
    expect(miss.body).toEqual(hit.body);
    expect(sender.sent).toHaveLength(1);
  });

  it("a provider failure still answers the same 202", async () => {
    const { admin, publicRoutes, sender } = setup();
    await seedStaff(admin, "platform-admin");
    sender.send = () => Promise.reject(new Error("provider down"));
    const res = await call(find(publicRoutes, "POST", REQUEST), { email: "owner@example.test" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ outcome: "sent-if-exists" });
  });

  it("a token-store failure still answers the same 202 (no 500 that tells a real account apart)", async () => {
    const failing: PasswordResetTokenStore = {
      save: () => Promise.reject(new Error("relation does not exist")),
      consume: () => Promise.reject(new Error("relation does not exist")),
    };
    const { admin, publicRoutes, sender } = setup(undefined, failing);
    await seedStaff(admin, "platform-admin");
    const res = await call(find(publicRoutes, "POST", REQUEST), { email: "owner@example.test" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ outcome: "sent-if-exists" });
    expect(sender.sent).toHaveLength(0);
  });

  it("the sixth request inside an hour is 429, keyed by tenant and normalised email", async () => {
    const limiter = new CountingRateLimiter();
    const { publicRoutes } = setup(limiter);
    const route = find(publicRoutes, "POST", REQUEST);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await call(route, { email: " Owner@Example.test " })).status).toBe(202);
    }
    const refused = await call(route, { email: "OWNER@example.test" });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: "RATE_LIMITED", retryable: true, fields: [] });
    expect(refused.headers?.["retry-after"]).toBeDefined();
    expect(new Set(limiter.keys)).toEqual(
      new Set([`rl:${TENANT}:staff-reset-request:owner@example.test|5|3600000`]),
    );
    expect((await call(route, { email: "other@example.test" })).status).toBe(202);
  });

  it("completion is limited to 10 per 15 minutes per tenant", async () => {
    const limiter = new CountingRateLimiter();
    const { publicRoutes } = setup(limiter);
    const route = find(publicRoutes, "POST", COMPLETE);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call(route, { token: "nope", password: "whatever-pass-1" })).status).toBe(400);
    }
    expect((await call(route, { token: "nope", password: "whatever-pass-1" })).status).toBe(429);
    expect(new Set(limiter.keys)).toEqual(new Set([`rl:${TENANT}:staff-reset-complete|10|900000`]));
  });

  it("change password needs the current one", async () => {
    const { admin, publicRoutes, accountRoutes } = setup();
    await seedStaff(admin, "platform-admin");
    const route = find(accountRoutes, "POST", "/auth/staff/password");
    expect(route.permission).toBe("account:update_self");
    const me = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: TENANT };
    const wrong = await call(
      route,
      { currentPassword: "not-it-at-all", newPassword: "next-pass-123" },
      me,
    );
    expect(wrong.status).toBe(401);
    const weak = await call(
      route,
      { currentPassword: "fake-password-1", newPassword: "short" },
      me,
    );
    expect(weak.status).toBe(422);
    const ok = await call(
      route,
      { currentPassword: "fake-password-1", newPassword: "next-pass-123" },
      me,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ outcome: "changed" });
    const login = find(publicRoutes, "POST", LOGIN);
    expect(
      (await call(login, { email: "owner@example.test", password: "next-pass-123" })).status,
    ).toBe(200);
    expect(
      (await call(login, { email: "owner@example.test", password: "fake-password-1" })).status,
    ).toBe(401);
  });

  it("a principal with no staff credential cannot change a password", async () => {
    const { accountRoutes } = setup();
    const route = find(accountRoutes, "POST", "/auth/staff/password");
    const stranger = { id: "ghost", kind: "staff", roles: ["viewer"], tenantId: TENANT };
    const res = await call(route, { currentPassword: "x", newPassword: "next-pass-123" }, stranger);
    expect(res.status).toBe(401);
  });
});
