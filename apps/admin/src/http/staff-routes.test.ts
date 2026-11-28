import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  SecurityController,
} from "@platform/security";
import { TenancyController } from "@platform/tenancy";
import { createAdminHttpApi } from "./server";

/**
 * Wave 1d — Settings > Users and permissions, driven through the REAL admin pipeline
 * (`createAdminHttpApi`, `tenantMode: "multi"`): real merchant sign-up for the stores and their owners, the
 * real `RoleTableAccessControl` behind the live staff access control, a real `NativeTokenIssuer` whose tokens
 * a real `JwtVerifier` checks, real scrypt hashing (the hashed provider is injected, so a password saved by
 * accepting an invitation is the one staff sign-in verifies) and in-memory Security/Tenancy. Only the
 * Redis-shaped ports and the email sender are doubles. Every member below is created the product's way:
 * invite, read the emailed link, accept, sign in.
 *
 * Layer under test: application (transport + composition). No RLS, no Postgres.
 */

const PLATFORM = "platform";
const API = "/api/v1";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "correct horse 1";
const BASE_MS = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

/** The app clock; tests that need an invitation to age move it and `afterEach` puts it back. */
const clockState = { offsetMs: 0 };
const clock: Clock = { now: () => new Date(BASE_MS + clockState.offsetMs) };

class RecordingSender {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  failNext = false;
  send(message: { to: string; subject: string; text: string }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("provider down"));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
  /** The single-use token in the most recent invitation email sent to `to`. */
  tokenFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const token = /accept-invite\?token=([^&\s]+)&store=/.exec(mail?.text ?? "")?.[1];
    if (token === undefined) throw new Error(`no invitation email for ${to}`);
    return decodeURIComponent(token);
  }
  countFor(to: string): number {
    return this.sent.filter((m) => m.to === to).length;
  }
}

function infra() {
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
  const rateLimiter: RateLimiter = {
    consume: async (key, limit) => {
      const used = ((kv.get(`rl:${key}`) as number | undefined) ?? 0) + 1;
      kv.set(`rl:${key}`, used);
      return { allowed: used <= limit, remaining: Math.max(0, limit - used), retryAfterMs: 1_000 };
    },
  };
  return { cache, idempotencyKeys, rateLimiter };
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
}

async function boot(options: { delivery: boolean }): Promise<Harness> {
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
  });
  const resolver = localKeyResolver(issuer);
  const authenticator = new JwtVerifier({
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    getKey: (header, token) => resolver.then((getKey) => getKey(header, token)),
    logger: silent,
  });
  const sender = new RecordingSender();
  const fx = infra();
  const app = await createAdminHttpApi({
    tenantMode: "multi",
    tenantId: PLATFORM,
    serializer,
    idGenerator,
    clock,
    licensing,
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter: fx.rateLimiter,
    idempotencyKeys: fx.idempotencyKeys,
    responseCache: fx.cache,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: issuer,
    emailSender: sender,
    ...(options.delivery ? { staffInviteEmailSender: sender } : {}),
    adminPublicUrl: "https://admin.test",
    platformStoreDomain: "morbeh.test",
    dnsVerifier: { pointsToPlatform: async () => false },
    defaultPlanKey: "basic",
  });
  await seedBasicPlan(licensing);
  return { app, sender, issuer };
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
interface StaffItem {
  readonly principalExternalId: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly isOwner: boolean;
  readonly isSelf: boolean;
  readonly invitation: { id: string; expiresAt: string; version: number } | null;
}

/** Spies that call through, plus the faults a test may arm. They also hand the tests the tenancy instance. */
const faults = {
  createInvitation: null as null | "throw" | "500",
  release: null as null | "throw" | "err",
};
let tenancyRef: TenancyController | undefined;
const originals = {
  find: TenancyController.prototype.findStaffDirectoryEntry,
  release: TenancyController.prototype.releaseStaffEmail,
  create: SecurityController.prototype.createStaffInvitation,
};
const reserveSpy = vi.spyOn(TenancyController.prototype, "reserveStaffEmail");
const releaseSpy = vi.spyOn(TenancyController.prototype, "releaseStaffEmail");
const staffAccessSpy = vi.spyOn(SecurityController.prototype, "staffAccess");
const createSpy = vi.spyOn(SecurityController.prototype, "createStaffInvitation");

const rememberTenancy = (instance: TenancyController): void => {
  tenancyRef = instance;
};
vi.spyOn(TenancyController.prototype, "findStaffDirectoryEntry").mockImplementation(function (
  this: TenancyController,
  email: string,
) {
  rememberTenancy(this);
  return originals.find.call(this, email);
});
releaseSpy.mockImplementation(function (
  this: TenancyController,
  ...args: Parameters<TenancyController["releaseStaffEmail"]>
) {
  if (faults.release === "throw") {
    faults.release = null;
    return Promise.reject(new Error("directory down"));
  }
  if (faults.release === "err") {
    faults.release = null;
    return Promise.resolve({ ok: false, error: new Error("directory refused") } as never);
  }
  return originals.release.apply(this, args);
});
createSpy.mockImplementation(function (
  this: SecurityController,
  ...args: Parameters<SecurityController["createStaffInvitation"]>
) {
  if (faults.createInvitation === "throw") {
    faults.createInvitation = null;
    return Promise.reject(new Error("security down"));
  }
  if (faults.createInvitation === "500") {
    faults.createInvitation = null;
    return Promise.resolve({ status: 500, body: { code: "UNEXPECTED", message: "boom" } });
  }
  return originals.create.apply(this, args);
});

let h: Harness;
let app: FastifyInstance;
let sender: RecordingSender;
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
const get = (token: string, url: string, target = app) =>
  target.inject({ method: "GET", url: `${API}${url}`, headers: headers(token) });
const post = (
  token: string,
  url: string,
  payload: unknown = {},
  key: string = randomUUID(),
  target = app,
) =>
  target.inject({
    method: "POST",
    url: `${API}${url}`,
    headers: headers(token, { "idempotency-key": key }),
    payload: payload as object,
  });
const publicPost = (url: string, tenant: string, payload: unknown, target = app) =>
  target.inject({
    method: "POST",
    url: `${API}${url}`,
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    payload: payload as object,
  });
const staffLogin = (store: Store, email: string, password: string) =>
  publicPost("/public/auth/staff/login", store.tenantId, { email, password });
const accept = (store: Store, token: string, password: string) =>
  publicPost("/public/auth/staff/invitations/accept", store.tenantId, { token, password });
const merchantLogin = (email: string, password: string) =>
  publicPost("/public/auth/merchant/login", PLATFORM, { email, password });
const body = (res: LightMyRequestResponse) => res.json() as Record<string, unknown>;
const unique = () => `Segment ${randomUUID().slice(0, 8)}`;
const SEGMENT = () => ({
  name: unique(),
  conditions: [{ field: "orders_count", op: "gte", value: 2 }],
});

async function signUpStore(storeName: string, email: string, target = app): Promise<Store> {
  const res = await publicPost(
    "/public/merchant-signup",
    PLATFORM,
    { storeName, email, password: PASSWORD, country: "EG", siteType: "store" },
    target,
  );
  expect(res.statusCode).toBe(201);
  const out = res.json() as { tenantId: string; accessToken: string };
  return { tenantId: out.tenantId, token: out.accessToken, email };
}

async function listOf(token: string): Promise<StaffItem[]> {
  const res = await get(token, "/staff");
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: StaffItem[] }).items;
}
const itemFor = async (token: string, email: string) =>
  (await listOf(token)).find((item) => item.email === email);

/** Invite + read the emailed link + accept + sign in: a member created the product's way. */
async function onboard(store: Store, email: string, role: Role): Promise<Member> {
  const invited = await post(store.token, "/staff/invitations", { email, role });
  expect(invited.statusCode).toBe(201);
  const { invitationId, principalExternalId } = invited.json() as {
    invitationId: string;
    principalExternalId: string;
  };
  const accepted = await accept(store, sender.tokenFor(email), NEW_PASSWORD);
  expect(accepted.statusCode).toBe(200);
  const login = await staffLogin(store, email, NEW_PASSWORD);
  expect(login.statusCode).toBe(200);
  return {
    email,
    externalId: principalExternalId,
    invitationId,
    token: (login.json() as { accessToken: string }).accessToken,
  };
}
const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@alpha.test`;

beforeAll(async () => {
  h = await boot({ delivery: true });
  app = h.app;
  sender = h.sender;
  alpha = await signUpStore("Alpha Store", "owner@alpha.test");
  beta = await signUpStore("Beta Store", "owner@beta.test");
  alphaAdmin = await onboard(alpha, "admin@alpha.test", "admin");
  alphaOperator = await onboard(alpha, "operator@alpha.test", "operator");
  alphaViewer = await onboard(alpha, "viewer@alpha.test", "viewer");
});
afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});
beforeEach(() => {
  expect.hasAssertions();
});
afterEach(() => {
  clockState.offsetMs = 0;
  faults.createInvitation = null;
  faults.release = null;
  sender.failNext = false;
});

describe("GET /staff", () => {
  it("lists the owner first (isSelf for the caller) then the members by email, never a token or hash", async () => {
    const res = await get(alpha.token, "/staff");
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: StaffItem[] }).items;
    expect(items[0]).toMatchObject({
      email: "owner@alpha.test",
      role: "owner",
      status: "active",
      isOwner: true,
      isSelf: true,
      invitation: null,
    });
    const rest = items.slice(1).map((item) => item.email);
    expect(rest).toEqual([...rest].sort());
    expect(items.find((i) => i.email === "operator@alpha.test")).toMatchObject({
      role: "operator",
      status: "active",
      isSelf: false,
    });
    for (const member of [alphaAdmin, alphaOperator, alphaViewer]) {
      expect(res.body).not.toContain(h.sender.tokenFor(member.email));
    }
    expect(res.body.toLowerCase()).not.toContain("tokenhash");
    expect(res.body.toLowerCase()).not.toContain("password");
  });

  it("is tenant-scoped: store B's list never shows store A's people", async () => {
    const items = await listOf(beta.token);
    expect(items.map((i) => i.email)).toEqual(["owner@beta.test"]);
  });
});

describe("operator and viewer are refused on every staff route (403, nothing happens)", () => {
  it.each([
    ["operator", () => alphaOperator.token],
    ["viewer", () => alphaViewer.token],
  ])("%s", async (_name, tokenOf) => {
    const token = tokenOf();
    const before = JSON.stringify(await listOf(alpha.token));
    const id = randomUUID();
    const responses = [
      await get(token, "/staff"),
      await post(token, "/staff/invitations", { email: "x@alpha.test", role: "viewer" }),
      await post(token, `/staff/invitations/${id}/resend`, { expectedVersion: 1 }),
      await post(token, `/staff/invitations/${id}/revoke`, { expectedVersion: 1 }),
      await post(token, `/staff/${alphaViewer.externalId}/role`, { role: "admin" }),
      await post(token, `/staff/${alphaViewer.externalId}/active`, { active: false }),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(JSON.stringify(await listOf(alpha.token))).toBe(before);
    expect(sender.countFor("x@alpha.test")).toBe(0);
  });

  it("an invited admin may use them (staff:* is admin-only through *:*)", async () => {
    expect((await get(alphaAdmin.token, "/staff")).statusCode).toBe(200);
  });
});

describe("POST /staff/invitations", () => {
  it("201, one email to the normalised address with the accept link and the store, listed as invited", async () => {
    const email = uniqueEmail("Sam");
    const before = sender.sent.length;
    const res = await post(alpha.token, "/staff/invitations", {
      email: ` ${email.toUpperCase()} `,
      role: "operator",
    });
    expect(res.statusCode).toBe(201);
    const out = res.json() as { invitationId: string; principalExternalId: string };
    expect(Object.keys(out).sort()).toEqual(["invitationId", "principalExternalId"]);
    expect(sender.sent).toHaveLength(before + 1);
    const mail = sender.sent[sender.sent.length - 1]!;
    expect(mail.to).toBe(email.toLowerCase());
    expect(mail.text).toContain("https://admin.test/accept-invite?token=");
    expect(mail.text).toContain(`&store=${encodeURIComponent(alpha.tenantId)}`);
    expect(res.body).not.toContain(sender.tokenFor(email.toLowerCase()));
    const item = await itemFor(alpha.token, email.toLowerCase());
    expect(item).toMatchObject({
      role: "operator",
      status: "invited",
      principalExternalId: out.principalExternalId,
      invitation: { id: out.invitationId, version: 1 },
    });
  });

  it("the same email again is 409 (pending invitation); an existing member is 409 (already on your staff)", async () => {
    const email = uniqueEmail("dup");
    expect(
      (await post(alpha.token, "/staff/invitations", { email, role: "viewer" })).statusCode,
    ).toBe(201);
    const sentBefore = sender.sent.length;
    const again = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    expect(again.statusCode).toBe(409);
    expect(body(again).message).toBe("This email already has a pending invitation");
    const member = await post(alpha.token, "/staff/invitations", {
      email: "operator@alpha.test",
      role: "viewer",
    });
    expect(member.statusCode).toBe(409);
    expect(body(member).message).toBe("This person is already on your staff");
    const owner = await post(alpha.token, "/staff/invitations", {
      email: "OWNER@alpha.test",
      role: "admin",
    });
    expect(owner.statusCode).toBe(409);
    expect(sender.sent).toHaveLength(sentBefore);
  });

  it("an email another store uses is 409 'already used by another store', and no principal is created", async () => {
    const before = JSON.stringify(await listOf(alpha.token));
    const res = await post(alpha.token, "/staff/invitations", {
      email: "owner@beta.test",
      role: "admin",
    });
    expect(res.statusCode).toBe(409);
    expect(body(res).message).toBe("This email is already used by another store");
    expect(JSON.stringify(await listOf(alpha.token))).toBe(before);
    expect(sender.countFor("owner@beta.test")).toBe(0);
    // Another shop's row is never deleted or replaced: store B's owner still signs in.
    expect(await tenancyRef?.findStaffDirectoryEntry("owner@beta.test")).toMatchObject({
      shopId: beta.tenantId,
      status: "active",
    });
    expect((await merchantLogin("owner@beta.test", PASSWORD)).statusCode).toBe(200);
  });

  it("validates structure (422 VALIDATION) and the email's shape (422 field email) before writing anything", async () => {
    const before = reserveSpy.mock.calls.length;
    const bad = await post(alpha.token, "/staff/invitations", { email: "nope", role: "viewer" });
    expect(bad.statusCode).toBe(422);
    expect(JSON.stringify(body(bad).fields)).toContain("email");
    expect(
      (await post(alpha.token, "/staff/invitations", { email: "a@b.co", role: "owner" }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post(alpha.token, "/staff/invitations", { email: "a@b.co", role: "admin", extra: 1 }))
        .statusCode,
    ).toBe(422);
    expect(reserveSpy.mock.calls.length).toBe(before);
  });

  it("a failing email sender: 502 EMAIL_FAILED, the invitation stays pending, and Resend delivers a working link", async () => {
    const email = uniqueEmail("flaky");
    sender.failNext = true;
    const res = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    expect(res.statusCode).toBe(502);
    expect(body(res)).toMatchObject({
      code: "EMAIL_FAILED",
      message: "The invitation was saved but the email couldn't be sent. Use Resend.",
    });
    const item = await itemFor(alpha.token, email);
    expect(item?.status).toBe("invited");
    expect(sender.countFor(email)).toBe(0);
    const resend = await post(alpha.token, `/staff/invitations/${item!.invitation!.id}/resend`, {
      expectedVersion: item!.invitation!.version,
    });
    expect(resend.statusCode).toBe(200);
    expect((await accept(alpha, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("with no real delivery capability: 503 NOT_CONFIGURED before any write (nothing listed, no directory call)", async () => {
    const bare = await boot({ delivery: false });
    try {
      const store = await signUpStore("Gamma Store", "owner@gamma.test", bare.app);
      const reservations = reserveSpy.mock.calls.length;
      const res = await post(
        store.token,
        "/staff/invitations",
        { email: "x@gamma.test", role: "viewer" },
        randomUUID(),
        bare.app,
      );
      expect(res.statusCode).toBe(503);
      // The same flat envelope every other admin error uses (no nested `error` wrapper).
      expect(res.json()).toEqual({
        code: "NOT_CONFIGURED",
        message: "Email isn't set up, so invitations can't be sent",
        retryable: false,
        fields: [],
      });
      const list = await get(store.token, "/staff", bare.app);
      expect((list.json() as { items: StaffItem[] }).items.map((i) => i.email)).toEqual([
        "owner@gamma.test",
      ]);
      expect(reserveSpy.mock.calls.length).toBe(reservations);
      expect(bare.sender.sent).toHaveLength(0);
      const resend = await post(
        store.token,
        `/staff/invitations/${randomUUID()}/resend`,
        { expectedVersion: 1 },
        randomUUID(),
        bare.app,
      );
      expect(resend.statusCode).toBe(503);
    } finally {
      await bare.app.close();
    }
  });

  it("an invited admin can invite too (staff:invite) and the invitation is theirs", async () => {
    const email = uniqueEmail("by-admin");
    expect(
      (await post(alphaAdmin.token, "/staff/invitations", { email, role: "viewer" })).statusCode,
    ).toBe(201);
    expect((await itemFor(alpha.token, email))?.status).toBe("invited");
  });
});

describe("accepting an invitation (public staff route)", () => {
  it("sets the password: 200, then staff sign-in and merchant sign-in work; the link is single-use (410)", async () => {
    const email = uniqueEmail("ada");
    expect(
      (await post(alpha.token, "/staff/invitations", { email, role: "operator" })).statusCode,
    ).toBe(201);
    expect((await staffLogin(alpha, email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await merchantLogin(email, NEW_PASSWORD)).statusCode).toBe(401);
    const token = sender.tokenFor(email);

    const done = await accept(alpha, token, NEW_PASSWORD);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({});

    const login = await staffLogin(alpha, email, NEW_PASSWORD);
    expect(login.statusCode).toBe(200);
    expect((await merchantLogin(email, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await staffLogin(alpha, email, "another password 1")).statusCode).toBe(401);
    expect((await itemFor(alpha.token, email))?.status).toBe("active");

    const again = await accept(alpha, token, "a different password");
    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({
      code: "INVITATION_INVALID",
      message: "This invitation link is invalid or has expired",
    });
    // The first password was not overwritten by the replay.
    expect((await staffLogin(alpha, email, NEW_PASSWORD)).statusCode).toBe(200);
    // The new member's token carries their role: an operator may write customers, not read staff.
    const { accessToken } = login.json() as { accessToken: string };
    expect((await post(accessToken, "/customer-segments", SEGMENT())).statusCode).toBe(201);
    expect((await get(accessToken, "/staff")).statusCode).toBe(403);
  });

  it("answers the SAME 410 for an unknown token, a token of another store, a bad store and a malformed token", async () => {
    const email = uniqueEmail("same");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const real = sender.tokenFor(email);
    const answers = [
      await accept(alpha, "no-such-token", NEW_PASSWORD),
      await accept(beta, real, NEW_PASSWORD), // another store's tenant
      await accept(alpha, "%%%", NEW_PASSWORD),
      await accept(alpha, "a".repeat(512), NEW_PASSWORD),
    ];
    expect(answers.map((r) => r.statusCode)).toEqual([410, 410, 410, 410]);
    expect(new Set(answers.map((r) => r.body)).size).toBe(1);
    // A store id that does not exist never reaches the route: the tenant gate refuses it, like every public route.
    const unknownStore = await publicPost(
      "/public/auth/staff/invitations/accept",
      "no-such-store",
      {
        token: real,
        password: NEW_PASSWORD,
      },
    );
    expect(unknownStore.statusCode).toBe(403);
    // Nothing was consumed.
    expect((await accept(alpha, real, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("a 7-character password is 422 on field password and the link still works afterwards", async () => {
    const email = uniqueEmail("weak");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const token = sender.tokenFor(email);
    const weak = await accept(alpha, token, "1234567");
    expect(weak.statusCode).toBe(422);
    expect(JSON.stringify(body(weak).fields)).toContain("password");
    expect((await accept(alpha, token, "x".repeat(257))).statusCode).toBe(422);
    expect((await accept(alpha, token, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("an invitation past 7 days is 410, listed invitation_expired; Resend restarts it and the new link works", async () => {
    const email = uniqueEmail("late");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const token = sender.tokenFor(email);
    clockState.offsetMs = 7 * DAY_MS + 1_000;
    expect((await accept(alpha, token, NEW_PASSWORD)).statusCode).toBe(410);
    const item = await itemFor(alpha.token, email);
    expect(item?.status).toBe("invitation_expired");
    const resend = await post(alpha.token, `/staff/invitations/${item!.invitation!.id}/resend`, {
      expectedVersion: item!.invitation!.version,
    });
    expect(resend.statusCode).toBe(200);
    expect((await accept(alpha, token, NEW_PASSWORD)).statusCode).toBe(410);
    expect((await accept(alpha, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("is rate limited per token hash: the 11th attempt in the window is 429 RATE_LIMITED", async () => {
    const token = `limit-${randomUUID()}`;
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1)
      codes.push((await accept(alpha, token, NEW_PASSWORD)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 410)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("the merchant twin (store in the body, platform tenant) accepts the same link and is rate limited too", async () => {
    const email = uniqueEmail("twin");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const token = sender.tokenFor(email);
    const wrongTenant = await publicPost(
      "/public/auth/merchant/invitations/accept",
      alpha.tenantId,
      {
        store: alpha.tenantId,
        token,
        password: NEW_PASSWORD,
      },
    );
    expect(wrongTenant.statusCode).toBe(403);
    const done = await publicPost("/public/auth/merchant/invitations/accept", PLATFORM, {
      store: alpha.tenantId,
      token,
      password: NEW_PASSWORD,
    });
    expect(done.statusCode).toBe(200);
    expect((await merchantLogin(email, NEW_PASSWORD)).statusCode).toBe(200);
    const replay = await publicPost("/public/auth/merchant/invitations/accept", PLATFORM, {
      store: alpha.tenantId,
      token,
      password: NEW_PASSWORD,
    });
    expect(replay.statusCode).toBe(410);
    const spam = `twin-${randomUUID()}`;
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      codes.push(
        (
          await publicPost("/public/auth/merchant/invitations/accept", PLATFORM, {
            store: alpha.tenantId,
            token: spam,
            password: NEW_PASSWORD,
          })
        ).statusCode,
      );
    }
    expect(codes[10]).toBe(429);
  });

  it("a plain staff or merchant password-reset request for an invited, not-yet-accepted email sends nothing", async () => {
    const email = uniqueEmail("pending");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const before = sender.sent.length;
    const staff = await publicPost("/public/auth/staff/password-reset/request", alpha.tenantId, {
      email,
    });
    const merchant = await publicPost("/public/auth/merchant/password-reset/request", PLATFORM, {
      email,
    });
    expect([staff.statusCode, merchant.statusCode]).toEqual([202, 202]);
    expect(sender.sent).toHaveLength(before);
    // And the invitation is still acceptable afterwards (nothing consumed or created).
    expect((await accept(alpha, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
  });
});

describe("resend and revoke", () => {
  it("resend rotates the link: a NEW email, the OLD link is 410 at once, the new one works", async () => {
    const email = uniqueEmail("resend");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const oldToken = sender.tokenFor(email);
    const item = (await itemFor(alpha.token, email))!;
    const res = await post(alpha.token, `/staff/invitations/${item.invitation!.id}/resend`, {
      expectedVersion: item.invitation!.version,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invitationId: item.invitation!.id, version: 2 });
    expect(sender.countFor(email)).toBe(2);
    const newToken = sender.tokenFor(email);
    expect(newToken).not.toBe(oldToken);
    expect((await accept(alpha, oldToken, NEW_PASSWORD)).statusCode).toBe(410);
    expect((await accept(alpha, newToken, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("a stale version is 409, an unknown or other store's invitation is 404, nothing is emailed for either", async () => {
    const email = uniqueEmail("stale");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const item = (await itemFor(alpha.token, email))!;
    const sentBefore = sender.sent.length;
    const stale = await post(alpha.token, `/staff/invitations/${item.invitation!.id}/resend`, {
      expectedVersion: 9,
    });
    expect(stale.statusCode).toBe(409);
    expect(body(stale).message).toBe("This invitation was changed by someone else");
    expect(
      (await post(alpha.token, `/staff/invitations/${randomUUID()}/resend`, { expectedVersion: 1 }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await post(beta.token, `/staff/invitations/${item.invitation!.id}/resend`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(beta.token, `/staff/invitations/${item.invitation!.id}/revoke`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(sender.sent).toHaveLength(sentBefore);
    expect((await itemFor(alpha.token, email))?.status).toBe("invited");
  });

  it("revoke: gone from the list, the link is 410, the directory row is released; the same email can be invited again", async () => {
    const email = uniqueEmail("revoke");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const oldToken = sender.tokenFor(email);
    const item = (await itemFor(alpha.token, email))!;
    expect(await tenancyRef?.findStaffDirectoryEntry(email)).toMatchObject({
      shopId: alpha.tenantId,
      ownerExternalId: item.principalExternalId,
    });
    const res = await post(alpha.token, `/staff/invitations/${item.invitation!.id}/revoke`, {
      expectedVersion: item.invitation!.version,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invitationId: item.invitation!.id });
    expect(await itemFor(alpha.token, email)).toBeUndefined();
    expect(await tenancyRef?.findStaffDirectoryEntry(email)).toBeNull();
    expect((await accept(alpha, oldToken, NEW_PASSWORD)).statusCode).toBe(410);

    const again = await post(alpha.token, "/staff/invitations", { email, role: "operator" });
    expect(again.statusCode).toBe(201);
    expect((again.json() as { principalExternalId: string }).principalExternalId).not.toBe(
      item.principalExternalId,
    );
    expect((await accept(alpha, oldToken, NEW_PASSWORD)).statusCode).toBe(410);
    expect((await accept(alpha, sender.tokenFor(email), NEW_PASSWORD)).statusCode).toBe(200);
    expect((await itemFor(alpha.token, email))?.role).toBe("operator");
  });

  it("a revoke whose directory release fails still succeeds, and the next invite of that email is 201 (recovered)", async () => {
    const email = uniqueEmail("recover");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const item = (await itemFor(alpha.token, email))!;
    faults.release = "throw";
    const res = await post(alpha.token, `/staff/invitations/${item.invitation!.id}/revoke`, {
      expectedVersion: item.invitation!.version,
    });
    expect(res.statusCode).toBe(200);
    expect(await tenancyRef?.findStaffDirectoryEntry(email)).toMatchObject({
      ownerExternalId: item.principalExternalId,
    });
    const again = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    expect(again.statusCode).toBe(201);
    expect(await tenancyRef?.findStaffDirectoryEntry(email)).toMatchObject({
      ownerExternalId: (again.json() as { principalExternalId: string }).principalExternalId,
    });
  });
});

describe("failures while inviting give the directory entry back", () => {
  it.each([
    ["throws", "throw" as const, 500],
    ["answers 500", "500" as const, 500],
  ])(
    "createStaffInvitation %s: the failure is returned and the reservation is released",
    async (_n, mode, status) => {
      const email = uniqueEmail("fail");
      faults.createInvitation = mode;
      const res = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
      expect(res.statusCode).toBe(status);
      expect(await tenancyRef?.findStaffDirectoryEntry(email)).toBeNull();
      expect(await itemFor(alpha.token, email)).toBeUndefined();
      expect(sender.countFor(email)).toBe(0);
      expect(
        (await post(alpha.token, "/staff/invitations", { email, role: "viewer" })).statusCode,
      ).toBe(201);
    },
  );

  it("a failed release after a failed create is logged, not thrown, and the next invite recovers the leftover row", async () => {
    const email = uniqueEmail("both");
    faults.createInvitation = "500";
    faults.release = "throw";
    const res = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    expect(res.statusCode).toBe(500);
    expect(await tenancyRef?.findStaffDirectoryEntry(email)).not.toBeNull(); // the leftover
    expect(
      (await post(alpha.token, "/staff/invitations", { email, role: "viewer" })).statusCode,
    ).toBe(201);
  });

  it.each([
    ["throws", "throw" as const],
    ["answers 500", "500" as const],
  ])(
    "createStaffInvitation %s while a same-store row already held the email: that row is put back, not released",
    async (_n, mode) => {
      const email = uniqueEmail("restore");
      // First failure leaves a same-store directory row behind (the release fails too).
      faults.createInvitation = "500";
      faults.release = "throw";
      expect(
        (await post(alpha.token, "/staff/invitations", { email, role: "viewer" })).statusCode,
      ).toBe(500);
      const leftover = await tenancyRef?.findStaffDirectoryEntry(email);
      expect(leftover).toMatchObject({ shopId: alpha.tenantId });

      // The retry takes the row over (new owner id), fails to create, and must restore the OLD row.
      const releases = releaseSpy.mock.calls.length;
      faults.createInvitation = mode;
      const res = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
      expect(res.statusCode).toBe(500);
      expect(await tenancyRef?.findStaffDirectoryEntry(email)).toEqual(leftover);
      expect(releaseSpy.mock.calls.length).toBe(releases);
      expect(await itemFor(alpha.token, email)).toBeUndefined();
      expect(sender.countFor(email)).toBe(0);

      // Nothing was lost: the next invite still recovers it.
      const ok = await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
      expect(ok.statusCode).toBe(201);
      expect(await tenancyRef?.findStaffDirectoryEntry(email)).toMatchObject({
        ownerExternalId: (ok.json() as { principalExternalId: string }).principalExternalId,
      });
    },
  );
});

describe("role changes and deactivation bite on EXISTING tokens (D13, both guards)", () => {
  it("operator -> viewer: the existing token loses its operator rights at once (403); a fresh sign-in is a viewer", async () => {
    const m = await onboard(alpha, uniqueEmail("demote"), "operator");
    expect((await post(m.token, "/customer-segments", SEGMENT())).statusCode).toBe(201);
    const changed = await post(alpha.token, `/staff/${m.externalId}/role`, { role: "viewer" });
    expect(changed.statusCode).toBe(200);
    expect((await post(m.token, "/customer-segments", SEGMENT())).statusCode).toBe(403);
    // The old token only carries `operator`, which the member no longer holds: it narrows to nothing
    // (never widened to `viewer`) until they sign in again, and the fresh token is a viewer's.
    expect((await get(m.token, "/customers")).statusCode).toBe(403);
    const fresh = (await staffLogin(alpha, m.email, NEW_PASSWORD)).json() as {
      accessToken: string;
    };
    expect((await get(fresh.accessToken, "/customers")).statusCode).toBe(200);
    expect((await post(fresh.accessToken, "/customer-segments", SEGMENT())).statusCode).toBe(403);
    expect((await itemFor(alpha.token, m.email))?.role).toBe("viewer");
  });

  it("a token is never widened: a member promoted to admin keeps their OLD token's operator rights until they sign in again", async () => {
    const m = await onboard(alpha, uniqueEmail("promote"), "viewer");
    expect(
      (await post(alpha.token, `/staff/${m.externalId}/role`, { role: "admin" })).statusCode,
    ).toBe(200);
    expect((await post(m.token, "/customer-segments", SEGMENT())).statusCode).toBe(403);
    expect((await get(m.token, "/staff")).statusCode).toBe(403);
    const fresh = await staffLogin(alpha, m.email, NEW_PASSWORD);
    expect(
      (await get((fresh.json() as { accessToken: string }).accessToken, "/staff")).statusCode,
    ).toBe(200);
  });

  it("deactivate: 200, the existing token is 403 on a plain customers route, login is 401; reactivate: sign-in works", async () => {
    const m = await onboard(alpha, uniqueEmail("off"), "operator");
    expect((await get(m.token, "/customers")).statusCode).toBe(200);
    const off = await post(alpha.token, `/staff/${m.externalId}/active`, { active: false });
    expect(off.statusCode).toBe(200);
    expect((await get(m.token, "/customers")).statusCode).toBe(403);
    expect((await get(m.token, "/staff")).statusCode).toBe(403);
    expect((await staffLogin(alpha, m.email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await merchantLogin(m.email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await itemFor(alpha.token, m.email))?.status).toBe("deactivated");

    const on = await post(alpha.token, `/staff/${m.externalId}/active`, { active: true });
    expect(on.statusCode).toBe(200);
    const login = await staffLogin(alpha, m.email, NEW_PASSWORD);
    expect(login.statusCode).toBe(200);
    expect(
      (await get((login.json() as { accessToken: string }).accessToken, "/customers")).statusCode,
    ).toBe(200);
    expect((await itemFor(alpha.token, m.email))?.status).toBe("active");
  });

  it("an idempotency replay of an earlier successful POST by a deactivated member is 403, not the cached 201", async () => {
    const m = await onboard(alpha, uniqueEmail("replay"), "operator");
    const key = randomUUID();
    const payload = SEGMENT();
    const first = await post(m.token, "/customer-segments", payload, key);
    expect(first.statusCode).toBe(201);
    const control = await post(m.token, "/customer-segments", payload, key);
    expect(control.statusCode).toBe(201); // the replay is real while the member is active
    expect(control.json()).toEqual(first.json());
    await post(alpha.token, `/staff/${m.externalId}/active`, { active: false });
    const replay = await post(m.token, "/customer-segments", payload, key);
    expect(replay.statusCode).toBe(403);
  });

  it("self, owner and last-admin protection answer 409 with the plain text and change nothing", async () => {
    const owner = (await listOf(alpha.token)).find((i) => i.isOwner)!;
    const before = JSON.stringify(await listOf(alpha.token));
    const selfRole = await post(alphaAdmin.token, `/staff/${alphaAdmin.externalId}/role`, {
      role: "viewer",
    });
    expect([selfRole.statusCode, body(selfRole).message]).toEqual([
      409,
      "You can't change your own role",
    ]);
    const selfOff = await post(alphaAdmin.token, `/staff/${alphaAdmin.externalId}/active`, {
      active: false,
    });
    expect([selfOff.statusCode, body(selfOff).message]).toEqual([
      409,
      "You can't deactivate yourself",
    ]);
    const ownerRole = await post(alphaAdmin.token, `/staff/${owner.principalExternalId}/role`, {
      role: "viewer",
    });
    expect([ownerRole.statusCode, body(ownerRole).message]).toEqual([
      409,
      "The store owner's role can't be changed",
    ]);
    const ownerOff = await post(alphaAdmin.token, `/staff/${owner.principalExternalId}/active`, {
      active: false,
    });
    expect([ownerOff.statusCode, body(ownerOff).message]).toEqual([
      409,
      "The store owner can't be deactivated",
    ]);
    const ownerSelf = await post(alpha.token, `/staff/${owner.principalExternalId}/active`, {
      active: false,
    });
    expect(ownerSelf.statusCode).toBe(409);
    expect(JSON.stringify(await listOf(alpha.token))).toBe(before);
    expect((await get(alpha.token, "/staff")).statusCode).toBe(200);
  });

  it("an invited (not yet accepted) member cannot be deactivated: 409 'Revoke the invitation instead'", async () => {
    const email = uniqueEmail("inv");
    await post(alpha.token, "/staff/invitations", { email, role: "viewer" });
    const item = (await itemFor(alpha.token, email))!;
    const res = await post(alpha.token, `/staff/${item.principalExternalId}/active`, {
      active: false,
    });
    expect([res.statusCode, body(res).message]).toEqual([409, "Revoke the invitation instead"]);
  });

  it("another store's principal id is 404 for role and active, and nothing changes there", async () => {
    const other = await onboard(beta, `member-${randomUUID().slice(0, 8)}@beta.test`, "operator");
    expect(
      (await post(alpha.token, `/staff/${other.externalId}/role`, { role: "viewer" })).statusCode,
    ).toBe(404);
    expect(
      (await post(alpha.token, `/staff/${other.externalId}/active`, { active: false })).statusCode,
    ).toBe(404);
    expect((await get(other.token, "/customers")).statusCode).toBe(200);
    expect((await itemFor(beta.token, other.email))?.role).toBe("operator");
    expect(
      (await post(alpha.token, `/staff/${randomUUID()}/role`, { role: "viewer" })).statusCode,
    ).toBe(404);
  });
});

describe("owner-only resources (R5): an ACCEPTED invited admin cannot reach the security console or legacy provisioning", () => {
  const routes = (self: string, owner: string) =>
    [
      [
        "POST",
        "/security/role-assignments",
        { principalExternalId: self, roleKey: "platform-admin", grantedBy: self },
      ],
      ["POST", `/security/role-assignments/${randomUUID()}/revoke`, {}],
      ["POST", `/security/principals/${owner}/transitions`, { to: "suspended" }],
      [
        "POST",
        "/security/principals",
        { externalId: randomUUID(), kind: "human", displayName: "x" },
      ],
      [
        "POST",
        "/memberships",
        { organizationId: randomUUID(), userId: randomUUID(), role: "member" },
      ],
      ["POST", "/users", { email: "x@alpha.test", name: "x" }],
      ["POST", "/organizations", { name: "x" }],
    ] as const;

  it("the invited admin gets 403 on every one, operator and viewer too, and nothing changes", async () => {
    const owner = (await listOf(alpha.token)).find((i) => i.isOwner)!;
    const before = JSON.stringify(await listOf(alpha.token));
    for (const [who, token, self] of [
      ["admin", alphaAdmin.token, alphaAdmin.externalId],
      ["operator", alphaOperator.token, alphaOperator.externalId],
      ["viewer", alphaViewer.token, alphaViewer.externalId],
    ] as const) {
      for (const [, url, payload] of routes(self, owner.principalExternalId)) {
        const res = await post(token, url, payload);
        expect([who, url, res.statusCode]).toEqual([who, url, 403]);
      }
    }
    expect(JSON.stringify(await listOf(alpha.token))).toBe(before);
    expect((await get(alpha.token, "/staff")).statusCode).toBe(200); // the owner is untouched
    const owners = (await listOf(alpha.token)).filter((i) => i.isOwner);
    expect(owners.map((i) => i.email)).toEqual(["owner@alpha.test"]);
  });

  it("the owner passes the same guard (unchanged behaviour): the same routes answer something other than 403", async () => {
    const owner = (await listOf(alpha.token)).find((i) => i.isOwner)!;
    const probes: [string, unknown][] = [
      ["/security/role-assignments", { principalExternalId: "", roleKey: "", grantedBy: "" }], // 422, not 403
      [`/security/role-assignments/${randomUUID()}/revoke`, {}],
      [`/security/principals/${randomUUID()}/transitions`, { to: "suspended" }], // an unknown principal
      ["/memberships", {}], // 422
    ];
    for (const [url, payload] of probes) {
      const res = await post(alpha.token, url, payload);
      expect([url, res.statusCode === 403]).toEqual([url, false]);
    }
    expect(owner.isOwner).toBe(true);
  });

  it("security:authenticate stays open to everyone: a request carrying a staff token on a public sign-in route behaves as before", async () => {
    const withToken = (token: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url: `${API}/public/auth/staff/login`,
        headers: headers(token, { "x-tenant-id": alpha.tenantId }),
        payload: payload as object,
      });
    for (const token of [alphaAdmin.token, alphaViewer.token, "not-even-a-token"]) {
      expect(
        (await withToken(token, { email: alphaViewer.email, password: NEW_PASSWORD })).statusCode,
      ).toBe(200);
      expect(
        (await withToken(token, { email: alphaViewer.email, password: "wrong password 1" }))
          .statusCode,
      ).toBe(401);
    }
  });
});

describe("customer, service and public principals are untouched", () => {
  const forged = (kind: "customer" | "service") =>
    h.issuer
      .issue({
        sub: `${kind}-1`,
        tenantId: alpha.tenantId,
        kind: kind as never,
        roles: [],
        sid: "s",
      })
      .then((issued) => issued.token);

  it.each(["customer", "service"] as const)(
    "a %s token is decided exactly as before (403) without a staff lookup",
    async (kind) => {
      const token = await forged(kind);
      const reads = staffAccessSpy.mock.calls.length;
      expect((await get(token, "/customers")).statusCode).toBe(403);
      expect((await get(token, "/staff")).statusCode).toBe(403);
      expect(staffAccessSpy.mock.calls.length).toBe(reads);
    },
  );

  it("a public route needs no token at all and no staff lookup", async () => {
    const reads = staffAccessSpy.mock.calls.length;
    expect((await staffLogin(alpha, alphaViewer.email, NEW_PASSWORD)).statusCode).toBe(200);
    expect(staffAccessSpy.mock.calls.length).toBe(reads);
  });
});
