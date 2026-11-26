import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NativeTokenIssuer } from "@platform/auth";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { wireAdmin, type WiredAdmin } from "./composition";
import { bootstrapStaffOwner } from "./staff-owner-bootstrap";
import { publicAuthRoutes } from "./http/public-auth-routes";

/**
 * Wave 1f — the mandatory rule at the facade level: who it binds (the bootstrap owner, whose principal has
 * no tenantRef, included), who it never does (storefront customers), and when it stays off (the admin
 * default, or a server that can't ask for a code). `InMemoryTotpMfaProvider` accepts "123456".
 */

const TENANT = "tenant-local";
const EMAIL = "owner@example.test";
const PASSWORD = "fake-owner-password";
const CODE = "123456";
const clock: Clock = { now: () => new Date() };

function build(options: {
  staffTwoStepRequired?: boolean;
  mfaConfigured?: boolean;
  issuer?: boolean;
}): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    ...(options.issuer === false
      ? {}
      : {
          staffTokenIssuer: new NativeTokenIssuer({
            privateKey,
            issuer: "https://api.test/",
            audience: "morbeh-admin",
            ttlSeconds: 7200,
          }),
        }),
    ...(options.mfaConfigured === undefined ? {} : { mfaConfigured: options.mfaConfigured }),
    ...(options.staffTwoStepRequired === undefined
      ? {}
      : { staffTwoStepRequired: options.staffTwoStepRequired }),
  });
}

async function seedOwner(admin: WiredAdmin): Promise<void> {
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;
  expect(
    await bootstrapStaffOwner(admin, {
      tenantId: TENANT,
      email: EMAIL,
      password: PASSWORD,
      logger: silent,
    }),
  ).toBe("created");
}
const login = (admin: WiredAdmin) =>
  admin.staffAuth.login({ tenantId: TENANT, email: EMAIL, password: PASSWORD });
const errorCode = (res: { body: unknown }): string | undefined =>
  (res.body as { error?: { code?: string } }).error?.code;

beforeEach(() => {
  expect.hasAssertions();
});

describe("the bootstrap owner (tenantRef null) is forced like everyone else", () => {
  it("login → MFA_SETUP_REQUIRED → start → confirm → token + 10 backup codes → next login asks for a code", async () => {
    const admin = build({ staffTwoStepRequired: true, mfaConfigured: true });
    await seedOwner(admin);

    const first = await login(admin);
    expect(first.status).toBe(403);
    expect(errorCode(first)).toBe("MFA_SETUP_REQUIRED");
    const { setupChallenge } = first.body as { setupChallenge: string };

    const started = await admin.staffAuth.startSetupAtLogin(setupChallenge);
    expect(started.status).toBe(201);
    expect(started.headers?.["cache-control"]).toContain("no-store");
    const { enrollmentId, provisioningUri } = started.body as {
      enrollmentId: string;
      provisioningUri: string;
    };
    expect(provisioningUri).toContain(encodeURIComponent(EMAIL));

    const wrong = await admin.staffAuth.confirmSetupAtLogin({
      setupChallenge,
      enrollmentId,
      code: "000000",
    });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe("INVALID_CODE");

    const done = await admin.staffAuth.confirmSetupAtLogin({
      setupChallenge,
      enrollmentId,
      code: CODE,
    });
    expect(done.status).toBe(200);
    expect(done.headers?.["cache-control"]).toContain("no-store");
    const out = done.body as { accessToken: string; backupCodes: string[] };
    expect(out.accessToken.split(".")).toHaveLength(3);
    expect(out.backupCodes).toHaveLength(10);

    const second = await login(admin);
    expect(second.status).toBe(403);
    expect(errorCode(second)).toBe("MFA_REQUIRED");
    expect((second.body as { challenge?: string }).challenge).toEqual(expect.any(String));
  });

  it("turning two-step off is refused 409 TWO_STEP_REQUIRED before the password is even looked at", async () => {
    const admin = build({ staffTwoStepRequired: true, mfaConfigured: true });
    await seedOwner(admin);
    const first = await login(admin);
    const { setupChallenge } = first.body as { setupChallenge: string };
    const started = (await admin.staffAuth.startSetupAtLogin(setupChallenge)).body as {
      enrollmentId: string;
    };
    await admin.staffAuth.confirmSetupAtLogin({
      setupChallenge,
      enrollmentId: started.enrollmentId,
      code: CODE,
    });
    const disabled = await admin.staffAuth.disableTwoStep({
      tenantId: TENANT,
      principalExternalId: "does-not-matter",
      password: "wrong",
    });
    expect(disabled.status).toBe(409);
    expect(disabled.body).toMatchObject({ code: "TWO_STEP_REQUIRED" });
  });
});

describe("the rule stays off where it can't or shouldn't apply", () => {
  it("the admin default (no staffTwoStepRequired) is the Wave 1e behaviour: the password alone signs in", async () => {
    const admin = build({ mfaConfigured: true });
    await seedOwner(admin);
    const res = await login(admin);
    expect(res.status).toBe(200);
    expect((res.body as { accessToken?: string }).accessToken).toEqual(expect.any(String));
  });

  it("staffTwoStepRequired false is the same", async () => {
    const admin = build({ staffTwoStepRequired: false, mfaConfigured: true });
    await seedOwner(admin);
    expect((await login(admin)).status).toBe(200);
  });

  it("required but the code step is unavailable (no real TOTP provider key) never locks anyone out", async () => {
    const admin = build({ staffTwoStepRequired: true, mfaConfigured: false });
    await seedOwner(admin);
    expect((await login(admin)).status).toBe(200);
  });

  it("required but no token issuer: staff sign-in is the plain 503 and no setup challenge exists", async () => {
    const admin = build({ staffTwoStepRequired: true, mfaConfigured: true, issuer: false });
    await seedOwner(admin);
    expect((await login(admin)).status).toBe(503);
    expect((await admin.staffAuth.startSetupAtLogin("anything")).status).toBe(401);
  });

  it("with the rule off the setup routes accept nothing: a setup challenge from a rule-on server is just expired", async () => {
    const on = build({ staffTwoStepRequired: true, mfaConfigured: true });
    await seedOwner(on);
    const first = await login(on);
    const { setupChallenge } = first.body as { setupChallenge: string };
    // Same shape of server, rule off: even a challenge that verifies cannot start a setup there.
    const off = build({ staffTwoStepRequired: false, mfaConfigured: true });
    expect((await off.staffAuth.startSetupAtLogin(setupChallenge)).status).toBe(401);
    expect(
      errorCode(
        await off.staffAuth.confirmSetupAtLogin({ setupChallenge, enrollmentId: "x", code: CODE }),
      ),
    ).toBe("CHALLENGE_EXPIRED");
  });
});

describe("storefront customers never pass the flag", () => {
  it("a customer registers and signs in with the rule on, no setup and no code asked", async () => {
    const admin = build({ staffTwoStepRequired: true, mfaConfigured: true });
    const call = (path: string, body: unknown) => {
      const route = publicAuthRoutes(admin).find((r) => r.method === "POST" && r.path === path);
      if (route === undefined) throw new Error(`no route POST ${path}`);
      return route.handle({
        body,
        params: {},
        query: {},
        context: { tenantId: "shop-a", requestId: "req-1", headers: {} },
      } as never) as Promise<{ status: number; body: unknown }>;
    };
    const registered = await call("/public/auth/register", {
      email: "Sara@Example.com",
      name: "Sara",
      password: "fake-password-1",
    });
    expect(registered.status).toBe(201);
    const login = await call("/public/auth/login", {
      email: "sara@example.com",
      password: "fake-password-1",
    });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain("MFA_");
    expect(JSON.stringify(login.body)).not.toContain("setupChallenge");
  });
});
