import { describe, expect, it } from "vitest";
import { LoggingEmailSender, ResendEmailSender, wireAdmin } from "@platform/admin";
import {
  EnvelopeEmailConnectionVault,
  InMemoryEmailConnectionVault,
  RoutingStoreEmailProvider,
} from "@platform/notifications";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  PLATFORM_ADMIN_ROLE,
  ScryptPasswordHasher,
} from "@platform/security";
import {
  buildEmailConnectionVault,
  resolveEmailWiring,
  staffInviteDelivery,
  storeEmailDelivery,
} from "./email-wiring";

describe("resolveEmailWiring (Plan 1C)", () => {
  it("without a key: a logging sender", () => {
    const wiring = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "x@y.test" });
    expect(wiring.emailSender).toBeInstanceOf(LoggingEmailSender);
  });

  it("with a key: a Resend sender: Morbeh's own account, and nothing that sends a store's customer mail (D45)", () => {
    const wiring = resolveEmailWiring({
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <onboarding@resend.dev>",
    });
    expect(wiring.emailSender).toBeInstanceOf(ResendEmailSender);
    expect(Object.keys(wiring).sort()).toEqual(["deliveryConfigured", "emailSender"]);
  });
});

describe("staff invitation delivery capability (Wave 1d, R1)", () => {
  it("without RESEND_API_KEY: deliveryConfigured is false (the logging fallback is NOT a delivery)", () => {
    const wiring = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "x@y.test" });
    expect(wiring.deliveryConfigured).toBe(false);
    expect(wiring.emailSender).toBeInstanceOf(LoggingEmailSender);
  });

  it("with RESEND_API_KEY: deliveryConfigured is true", () => {
    const wiring = resolveEmailWiring({
      RESEND_API_KEY: "re_fake_key_123",
      EMAIL_FROM: "Morbeh <onboarding@resend.dev>",
    });
    expect(wiring.deliveryConfigured).toBe(true);
  });

  it("staffInviteDelivery passes the sender ONLY with a real delivery AND ADMIN_PUBLIC_URL", () => {
    const real = resolveEmailWiring({ RESEND_API_KEY: "re_fake_key_123", EMAIL_FROM: "a@b.test" });
    const logging = resolveEmailWiring({ RESEND_API_KEY: undefined, EMAIL_FROM: "a@b.test" });
    const url = "https://admin.test";
    expect(staffInviteDelivery(real, { ADMIN_PUBLIC_URL: url })).toEqual({
      staffInviteEmailSender: real.emailSender,
    });
    expect(staffInviteDelivery(real, { ADMIN_PUBLIC_URL: undefined })).toEqual({});
    expect(staffInviteDelivery(logging, { ADMIN_PUBLIC_URL: url })).toEqual({});
    expect(staffInviteDelivery(logging, { ADMIN_PUBLIC_URL: undefined })).toEqual({});
  });

  describe("the admin composed the way the runtime composes it", () => {
    const clock: Clock = { now: () => new Date("2026-11-24T10:00:00.000Z") };
    let n = 0;
    const idGenerator: IdGenerator = {
      generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
    };
    const owner: Principal = { id: "owner-1", kind: "staff", roles: ["admin"], tenantId: "t-1" };

    /** The signed-in owner exists in Security (the live access check looks them up), like after sign-up. */
    async function seedOwner(admin: ReturnType<typeof wireAdmin>): Promise<void> {
      const { security, identityDirectory } = admin.securityWiring;
      identityDirectory.register("owner-1");
      await security.registerPrincipal({
        tenantId: "t-1",
        externalId: "owner-1",
        kind: "human",
        displayName: "owner@example.test",
        subjectRef: "owner-1",
      });
      await security.defineRole({
        tenantId: "t-1",
        key: PLATFORM_ADMIN_ROLE,
        name: PLATFORM_ADMIN_ROLE,
        permissions: ["*:*"],
      });
      await security.assignRole({
        tenantId: "t-1",
        principalExternalId: "owner-1",
        roleKey: PLATFORM_ADMIN_ROLE,
        grantedBy: "test",
      });
    }

    function compose(
      config: {
        RESEND_API_KEY: string | undefined;
        ADMIN_PUBLIC_URL: string | undefined;
      },
      fetchImpl?: typeof fetch,
    ) {
      const email = resolveEmailWiring(
        { RESEND_API_KEY: config.RESEND_API_KEY, EMAIL_FROM: "a@b.test" },
        fetchImpl,
      );
      return wireAdmin({
        serializer: new JsonEventSerializer(),
        idGenerator,
        clock,
        emailSender: email.emailSender,
        ...(config.ADMIN_PUBLIC_URL === undefined
          ? {}
          : { adminPublicUrl: config.ADMIN_PUBLIC_URL }),
        ...staffInviteDelivery(email, config),
      });
    }

    it("no key: inviting answers 503 NOT_CONFIGURED and writes nothing", async () => {
      const admin = compose({ RESEND_API_KEY: undefined, ADMIN_PUBLIC_URL: "https://admin.test" });
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        code: "NOT_CONFIGURED",
        message: "Email isn't set up, so invitations can't be sent",
      });
      const list = await admin.staff.list(owner, "t-1");
      expect((list.body as { items: { email: string }[] }).items.map((i) => i.email)).toEqual([]);
    });

    it("a key but no ADMIN_PUBLIC_URL: 503 as well", async () => {
      const admin = compose({ RESEND_API_KEY: "re_fake_key_123", ADMIN_PUBLIC_URL: undefined });
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(503);
    });

    it("a key and ADMIN_PUBLIC_URL: the invitation is saved and Resend gets the one email", async () => {
      const calls: { url: string; body: string }[] = [];
      const fetchImpl = (async (url: string, init: { body: string }) => {
        calls.push({ url, body: init.body });
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch;
      const admin = compose(
        { RESEND_API_KEY: "re_fake_key_123", ADMIN_PUBLIC_URL: "https://admin.test" },
        fetchImpl,
      );
      await seedOwner(admin);
      const res = await admin.staff.invite(owner, "t-1", {
        email: "sam@example.test",
        role: "viewer",
      });
      expect(res.status).toBe(201);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.resend.com/emails");
      expect(calls[0]?.body).toContain("accept-invite?token=");
    });
  });
});

describe("storeEmailDelivery (Wave 2b2, D47/D48)", () => {
  const kek = "k".repeat(32);

  it("with the KEK: the real envelope vault and the Resend provider for the MERCHANT's key", () => {
    const wiring = storeEmailDelivery({ EMAIL_CREDENTIALS_KEK_REF: kek, APP_ENV: "production" });
    expect(wiring.emailVault).toBeInstanceOf(EnvelopeEmailConnectionVault);
    expect(wiring.emailVault?.backing).toBe("real");
    expect(wiring.emailProvider).toBeInstanceOf(RoutingStoreEmailProvider);
  });

  it("without the KEK outside local: NO vault (saving answers 503 NOT_CONFIGURED), but the provider is still wired", () => {
    for (const APP_ENV of ["production", "staging", "development"] as const) {
      const wiring = storeEmailDelivery({ EMAIL_CREDENTIALS_KEK_REF: undefined, APP_ENV });
      expect(wiring.emailVault).toBeUndefined();
      expect(wiring.emailProvider).toBeInstanceOf(RoutingStoreEmailProvider);
    }
  });

  it("without the KEK in local: the in-memory stub vault (the boot guard allows it only there)", () => {
    const wiring = storeEmailDelivery({ EMAIL_CREDENTIALS_KEK_REF: undefined, APP_ENV: "local" });
    expect(wiring.emailVault).toBeInstanceOf(InMemoryEmailConnectionVault);
    expect(wiring.emailVault?.backing).toBe("stub");
  });

  it("the sealed blob holds no key reference and opens only under the same KEK", async () => {
    const vault = buildEmailConnectionVault(kek);
    const sealed = await vault.seal("t-1", "resend", { apiKey: "re_store_secret_key_value_1234" });
    expect(sealed).not.toContain(kek);
    expect(sealed).not.toContain("kekRef");
    expect(sealed).not.toContain("re_store_secret_key_value_1234");
    expect(await vault.open("t-1", "resend", sealed)).toEqual({
      apiKey: "re_store_secret_key_value_1234",
    });
    await expect(
      buildEmailConnectionVault("j".repeat(32)).open("t-1", "resend", sealed),
    ).rejects.toThrow(/could not be opened/);
  });
});

describe("storeEmailDelivery and the SMTP flag (Wave 2b2 Task 3, D52)", () => {
  const smtpCredentials = {
    kind: "smtp" as const,
    apiKey: "app-password-1234",
    // localhost is a private address: a send is refused before any network is touched.
    smtp: { host: "localhost", port: 465, security: "tls" as const, username: "shop@gmail.test" },
  };
  const message = {
    to: "customer@example.test",
    subject: "Hi",
    text: "t",
    html: "<p>t</p>",
    from: "<shop@gmail.test>",
  };
  const unreachable = (calls: string[]) =>
    (async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

  it("EMAIL_SMTP_ENABLED defaults to off", () => {
    expect(
      storeEmailDelivery({ EMAIL_CREDENTIALS_KEK_REF: undefined, APP_ENV: "local" }).smtpEnabled,
    ).toBe(false);
  });

  it("off: no SMTP provider exists, so a mailbox connection can never send, whatever is stored", async () => {
    const calls: string[] = [];
    const wiring = storeEmailDelivery(
      {
        EMAIL_CREDENTIALS_KEK_REF: "k".repeat(32),
        APP_ENV: "production",
        EMAIL_SMTP_ENABLED: false,
      },
      unreachable(calls),
    );
    expect(wiring.smtpEnabled).toBe(false);
    expect(await wiring.emailProvider.send(smtpCredentials, message)).toMatchObject({
      ok: false,
      code: "EMAIL_PROVIDER_UNAVAILABLE",
    });
    expect(calls).toEqual([]);
  });

  it("on: mailbox credentials go to the SMTP provider (never to Resend's HTTPS API)", async () => {
    const calls: string[] = [];
    const wiring = storeEmailDelivery(
      {
        EMAIL_CREDENTIALS_KEK_REF: "k".repeat(32),
        APP_ENV: "production",
        EMAIL_SMTP_ENABLED: true,
      },
      unreachable(calls),
    );
    expect(wiring.smtpEnabled).toBe(true);
    // The SMTP provider answered (a private host is refused with its own fixed code).
    expect(await wiring.emailProvider.send(smtpCredentials, message)).toMatchObject({
      ok: false,
      code: "EMAIL_CONNECTION_FAILED",
    });
    expect(calls).toEqual([]);
    // Resend keys still go to Resend.
    await wiring.emailProvider.send(
      { kind: "resend", apiKey: "re_store_AbCdEfGhIjKlMnOpQrStUv1234" },
      message,
    );
    expect(calls).toEqual(["https://api.resend.com/emails"]);
  });
});

describe("a store's customer mail never touches the platform's account (D45), composed the way the runtime composes it", () => {
  const clock: Clock = { now: () => new Date("2026-11-26T10:00:00.000Z") };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const owner: Principal = { id: "owner-1", kind: "staff", roles: ["admin"], tenantId: "t-1" };
  const PLATFORM_KEY = "re_platform_morbeh_own_key_1";
  const STORE_KEY = "re_store_AbCdEfGhIjKlMnOpQrStUv1234";

  async function compose() {
    const platformCalls: { auth: string; body: string }[] = [];
    const storeCalls: { auth: string; body: string }[] = [];
    const record = (into: typeof platformCalls) => async (_url: string, init: RequestInit) => {
      into.push({
        auth: (init.headers as Record<string, string>)["authorization"] ?? "",
        body: String(init.body),
      });
      return { ok: true, status: 200, json: async () => ({ id: "1" }) } as unknown as Response;
    };
    const email = resolveEmailWiring(
      { RESEND_API_KEY: PLATFORM_KEY, EMAIL_FROM: "Morbeh <no-reply@morbeh.test>" },
      record(platformCalls) as unknown as typeof fetch,
    );
    const store = new InMemoryPasswordCredentialStore();
    await store.save({
      tenantId: "t-1",
      identifier: "staff:owner@merchant.test",
      principalExternalId: "owner-1",
      passwordHash: "x",
    });
    const admin = wireAdmin({
      serializer: new JsonEventSerializer(),
      idGenerator,
      clock,
      emailSender: email.emailSender,
      adminPublicUrl: "https://admin.test",
      passwordAuthProvider: new HashedPasswordAuthProvider({
        store,
        hasher: new ScryptPasswordHasher({ log2N: 10 }),
        clock,
      }),
      ...staffInviteDelivery(email, { ADMIN_PUBLIC_URL: "https://admin.test" }),
      ...storeEmailDelivery(
        { EMAIL_CREDENTIALS_KEK_REF: "k".repeat(32), APP_ENV: "production" },
        record(storeCalls) as unknown as typeof fetch,
      ),
    });
    const { security, identityDirectory } = admin.securityWiring;
    identityDirectory.register("owner-1");
    await security.registerPrincipal({
      tenantId: "t-1",
      externalId: "owner-1",
      kind: "human",
      displayName: "owner@merchant.test",
      subjectRef: "owner-1",
    });
    await security.defineRole({
      tenantId: "t-1",
      key: PLATFORM_ADMIN_ROLE,
      name: PLATFORM_ADMIN_ROLE,
      permissions: ["*:*"],
    });
    await security.assignRole({
      tenantId: "t-1",
      principalExternalId: "owner-1",
      roleKey: PLATFORM_ADMIN_ROLE,
      grantedBy: "test",
    });
    return { admin, platformCalls, storeCalls };
  }

  it("connecting a store's account and test-sending a template use the STORE's key; the platform's key is never sent", async () => {
    const { admin, platformCalls, storeCalls } = await compose();
    const saved = await admin.emailConnection.save(owner, {
      tenantId: "t-1",
      expectedVersion: null,
      kind: "resend",
      fromEmail: "shop@merchant.test",
      apiKey: STORE_KEY,
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(STORE_KEY);
    const test = await admin.notificationSettings.sendTest(owner, {
      tenantId: "t-1",
      key: "order_confirmation",
      locale: "en",
    });
    expect(test.status).toBe(200);
    expect(storeCalls.map((call) => call.auth)).toEqual([
      `Bearer ${STORE_KEY}`,
      `Bearer ${STORE_KEY}`,
    ]);
    expect(platformCalls).toHaveLength(0);
    expect(JSON.stringify(platformCalls)).not.toContain("shop@merchant.test");
  });

  it("with no connection nothing is sent at all for a template test: not even by the platform", async () => {
    const { admin, platformCalls, storeCalls } = await compose();
    const test = await admin.notificationSettings.sendTest(owner, {
      tenantId: "t-1",
      key: "order_confirmation",
      locale: "en",
    });
    expect(test.status).toBe(503);
    expect(test.body).toMatchObject({ code: "EMAIL_NOT_CONNECTED" });
    expect(storeCalls).toHaveLength(0);
    expect(platformCalls).toHaveLength(0);
  });

  it("staff invitations still go through the PLATFORM's account with the platform's key", async () => {
    const { admin, platformCalls, storeCalls } = await compose();
    const invited = await admin.staff.invite(owner, "t-1", {
      email: "sam@example.test",
      role: "viewer",
    });
    expect(invited.status).toBe(201);
    expect(platformCalls).toHaveLength(1);
    expect(platformCalls[0]?.auth).toBe(`Bearer ${PLATFORM_KEY}`);
    expect(platformCalls[0]?.body).toContain("accept-invite?token=");
    expect(storeCalls).toHaveLength(0);
  });
});
