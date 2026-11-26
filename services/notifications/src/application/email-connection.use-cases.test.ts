import { describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import type { EmailConnectionRepository } from "../domain/messaging/messaging-repositories";
import { InMemoryEmailConnectionRepository } from "../infrastructure/in-memory-messaging-repositories";
import { InMemoryStoreEmailProvider } from "../infrastructure/in-memory-store-email-provider";
import { testEmailVault } from "../testing/email-connection-doubles";
import { FIXED_NOW, fixedClock, STORE_KEY } from "../testing/store-email-fixture";
import {
  DeleteEmailConnection,
  GetEmailConnection,
  SaveEmailConnection,
  SetEmailConnectionEnabled,
  TestEmailConnection,
} from "./email-connection.use-cases";
import type { StoreProfilePort } from "./messaging-ports";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const ACTOR = "staff@nusuj.com";

const store: StoreProfilePort = {
  get: () => Promise.resolve({ storeName: "Nusuj Store", contactEmail: null, defaultLocale: "en" }),
};

function setup(options: { vault?: boolean; provider?: boolean } = {}) {
  const connections = new InMemoryEmailConnectionRepository();
  const provider = new InMemoryStoreEmailProvider();
  const vault = testEmailVault();
  const deps = {
    connections,
    store,
    clock: fixedClock,
    ...(options.vault === false ? {} : { vault }),
    ...(options.provider === false ? {} : { provider }),
  };
  return {
    connections,
    provider,
    vault,
    get: new GetEmailConnection(deps),
    save: new SaveEmailConnection(deps),
    setEnabled: new SetEmailConnectionEnabled(deps),
    remove: new DeleteEmailConnection(deps),
    test: new TestEmailConnection(deps),
  };
}

const draft = { kind: "resend", fromEmail: "Shop@Nusuj.com", apiKey: STORE_KEY };

function save(ctx: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return ctx.save.execute({
    tenantId: TENANT,
    expectedVersion: null,
    actorEmail: ACTOR,
    ...draft,
    ...overrides,
  });
}

describe("GetEmailConnection", () => {
  it("not connected: connection null; credentialsConfigured says whether the server can seal keys", async () => {
    expect.hasAssertions();
    expect(await setup().get.execute({ tenantId: TENANT })).toEqual({
      ok: true,
      value: { credentialsConfigured: true, smtpAvailable: false, connection: null },
    });
    expect(await setup({ vault: false }).get.execute({ tenantId: TENANT })).toMatchObject({
      value: { credentialsConfigured: false, connection: null },
    });
    expect(await setup({ provider: false }).get.execute({ tenantId: TENANT })).toMatchObject({
      value: { credentialsConfigured: false },
    });
  });
});

describe("SaveEmailConnection (D47-D49)", () => {
  it("seals the key, sends a test mail to the ACTING staff member through the store's own key, and connects", async () => {
    expect.hasAssertions();
    const ctx = setup();
    const result = await save(ctx);
    expect(result).toMatchObject({
      ok: true,
      value: {
        credentialsConfigured: true,
        connection: {
          kind: "resend",
          fromEmail: "shop@nusuj.com",
          secretLast4: STORE_KEY.slice(-4),
          enabled: true,
          status: "connected",
          state: "connected",
          lastError: null,
          verifiedAt: FIXED_NOW.toISOString(),
          version: 1,
        },
      },
    });
    expect(ctx.provider.calls).toHaveLength(1);
    expect(ctx.provider.calls[0]?.credentials).toEqual({ kind: "resend", apiKey: STORE_KEY });
    expect(ctx.provider.calls[0]?.message).toMatchObject({
      to: ACTOR,
      from: '"Nusuj Store" <shop@nusuj.com>',
    });
  });

  it("the response and the stored row never hold the key: only the last four and a sealed blob", async () => {
    expect.hasAssertions();
    const ctx = setup();
    const result = await save(ctx);
    expect(JSON.stringify(result)).not.toContain(STORE_KEY);
    const row = ctx.connections.peek(TENANT);
    expect(row?.sealedCredentials).not.toContain(STORE_KEY);
    expect(JSON.stringify(row)).not.toContain(STORE_KEY);
    expect(Object.keys(JSON.parse(row?.sealedCredentials ?? "{}") as object).sort()).toEqual([
      "alias",
      "ciphertext",
      "v",
      "wrappedDek",
    ]);
    expect(await ctx.vault.open(TENANT, "resend", row?.sealedCredentials ?? "")).toEqual({
      apiKey: STORE_KEY,
    });
  });

  it("a refused test saves status failed with the provider's sanitized message (200, not an error)", async () => {
    expect.hasAssertions();
    const ctx = setup();
    ctx.provider.failNext(
      "EMAIL_SENDER_REJECTED",
      `The nusuj.com domain is not verified. Tried ${STORE_KEY} for staff@nusuj.com`,
    );
    const result = await save(ctx);
    expect(result).toMatchObject({
      ok: true,
      value: {
        connection: {
          status: "failed",
          state: "failed",
          verifiedAt: null,
          lastErrorAt: FIXED_NOW.toISOString(),
        },
      },
    });
    const text = JSON.stringify(result);
    expect(text).toContain("domain is not verified");
    expect(text).not.toContain(STORE_KEY);
    expect(text).not.toContain(ACTOR);
    expect(JSON.stringify(ctx.connections.peek(TENANT))).not.toContain(ACTOR);
  });

  it("a provider that THROWS is a failed test with a fixed message: nothing it threw is kept", async () => {
    expect.hasAssertions();
    const ctx = setup();
    ctx.provider.throwNext();
    const result = await save(ctx);
    expect(result).toMatchObject({ ok: true, value: { connection: { status: "failed" } } });
    expect(JSON.stringify(result)).not.toContain("boom");
    expect(JSON.stringify(result)).not.toContain(STORE_KEY);
  });

  it("no KEK / no provider: 503 NOT_CONFIGURED 'Not available yet' and nothing is stored or sent", async () => {
    expect.hasAssertions();
    for (const options of [{ vault: false }, { provider: false }]) {
      const ctx = setup(options);
      const result = await save(ctx);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "NOT_CONFIGURED", message: "Not available yet" },
      });
      expect(ctx.connections.peek(TENANT)).toBeUndefined();
      expect(ctx.provider.calls).toHaveLength(0);
    }
  });

  it("validates the From email, the kind and the key shape before anything is sent; the key is never echoed", async () => {
    expect.hasAssertions();
    const ctx = setup();
    for (const bad of [
      { fromEmail: "" },
      { fromEmail: "not-an-email" },
      { fromEmail: "a@b.co\r\nBcc: x@y.z" },
      { kind: "sendgrid" },
      { apiKey: "not-a-resend-key" },
      { apiKey: "re_short" },
      { apiKey: "re_" + "x".repeat(200) },
    ]) {
      const result = await save(ctx, bad);
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      expect(JSON.stringify(result)).not.toContain("re_short");
    }
    expect(ctx.provider.calls).toHaveLength(0);
    expect(ctx.connections.peek(TENANT)).toBeUndefined();
  });

  it("a first save needs a key; the acting staff member needs an address", async () => {
    expect.hasAssertions();
    const ctx = setup();
    expect(await save(ctx, { apiKey: null })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fields: [{ field: "apiKey" }] },
    });
    expect(await save(ctx, { actorEmail: null })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("re-saving without a key keeps the stored one (new From address, re-tested with the same key)", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    ctx.provider.calls.length = 0;
    const again = await save(ctx, {
      expectedVersion: 1,
      apiKey: null,
      fromEmail: "orders@nusuj.com",
    });
    expect(again).toMatchObject({
      ok: true,
      value: { connection: { fromEmail: "orders@nusuj.com", version: 2, status: "connected" } },
    });
    expect(ctx.provider.calls[0]?.credentials.apiKey).toBe(STORE_KEY);
    expect(ctx.provider.calls[0]?.message.from).toBe('"Nusuj Store" <orders@nusuj.com>');
  });

  it("replacing the key seals the new one and shows its last four", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    const next = "re_newkey_xxxxxxxxxxxxxxxxxx9876";
    const again = await save(ctx, { expectedVersion: 1, apiKey: next });
    expect(again).toMatchObject({ value: { connection: { secretLast4: "9876", version: 2 } } });
    expect(
      await ctx.vault.open(TENANT, "resend", ctx.connections.peek(TENANT)?.sealedCredentials ?? ""),
    ).toEqual({ apiKey: next });
  });

  it("a key that no longer opens cannot be 'kept': it asks for the key again", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    const other = setup();
    // The same connection repository, but a vault under another KEK (a rotated/lost key).
    const rotated = new SaveEmailConnection({
      connections: ctx.connections,
      store,
      clock: fixedClock,
      vault: testEmailVault("another-kek-not-the-same-0000000000"),
      provider: other.provider,
    });
    const result = await rotated.execute({
      tenantId: TENANT,
      expectedVersion: 1,
      actorEmail: ACTOR,
      kind: "resend",
      fromEmail: "shop@nusuj.com",
      apiKey: null,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(other.provider.calls).toHaveLength(0);
  });

  it("answers CONFLICT on a stale version and never overwrites", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    expect(await save(ctx, { expectedVersion: null })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await save(ctx, { expectedVersion: 5 })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(ctx.connections.peek(TENANT)?.version).toBe(1);
  });

  it("maps a ConcurrencyError raised by the write to CONFLICT", async () => {
    expect.hasAssertions();
    const racing: EmailConnectionRepository = {
      find: () => Promise.resolve(null),
      save: () => Promise.reject(new ConcurrencyError("created concurrently")),
      remove: () => Promise.resolve(),
      recordFailure: () => Promise.resolve(),
    };
    const result = await new SaveEmailConnection({
      connections: racing,
      store,
      clock: fixedClock,
      vault: testEmailVault(),
      provider: new InMemoryStoreEmailProvider(),
    }).execute({ tenantId: TENANT, expectedVersion: null, actorEmail: ACTOR, ...draft });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("keeps each store's connection apart", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    expect(await ctx.get.execute({ tenantId: OTHER })).toMatchObject({
      value: { connection: null },
    });
    expect(ctx.connections.peek(OTHER)).toBeUndefined();
  });

  it("an unreadable From name cannot break out of the header", async () => {
    expect.hasAssertions();
    const ctx = setup();
    const evil = new SaveEmailConnection({
      connections: ctx.connections,
      store: {
        get: () =>
          Promise.resolve({
            storeName: 'X" <a@b.co>\r\nBcc: z@z.co',
            contactEmail: null,
            defaultLocale: null,
          }),
      },
      clock: fixedClock,
      vault: ctx.vault,
      provider: ctx.provider,
    });
    await evil.execute({ tenantId: TENANT, expectedVersion: null, actorEmail: ACTOR, ...draft });
    const from = ctx.provider.calls[0]?.message.from ?? "";
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.match(/</g)).toHaveLength(1);
  });
});

describe("SetEmailConnectionEnabled / DeleteEmailConnection / TestEmailConnection", () => {
  it("switching off keeps the key and status; switching on does not re-test", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    ctx.provider.calls.length = 0;
    const off = await ctx.setEnabled.execute({
      tenantId: TENANT,
      expectedVersion: 1,
      enabled: false,
    });
    expect(off).toMatchObject({
      value: { connection: { enabled: false, state: "disabled", status: "connected", version: 2 } },
    });
    const on = await ctx.setEnabled.execute({
      tenantId: TENANT,
      expectedVersion: 2,
      enabled: true,
    });
    expect(on).toMatchObject({ value: { connection: { enabled: true, state: "connected" } } });
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("the switch needs a connection and a fresh version", async () => {
    expect.hasAssertions();
    const ctx = setup();
    expect(
      await ctx.setEnabled.execute({ tenantId: TENANT, expectedVersion: 1, enabled: false }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await save(ctx);
    expect(
      await ctx.setEnabled.execute({ tenantId: TENANT, expectedVersion: 9, enabled: false }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await ctx.setEnabled.execute({ tenantId: OTHER, expectedVersion: 1, enabled: false }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("disconnecting deletes the row (and with it the sealed key); doing it twice is fine", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await save(ctx);
    expect(await ctx.remove.execute({ tenantId: TENANT })).toMatchObject({
      ok: true,
      value: { connection: null },
    });
    expect(ctx.connections.peek(TENANT)).toBeUndefined();
    expect(await ctx.remove.execute({ tenantId: TENANT })).toMatchObject({ ok: true });
  });

  it("'Send test' re-tests through the stored key and moves a failed connection to connected (and back)", async () => {
    expect.hasAssertions();
    const ctx = setup();
    ctx.provider.failNext("EMAIL_KEY_REJECTED", "API key is invalid");
    await save(ctx);
    expect(ctx.connections.peek(TENANT)?.status).toBe("failed");
    const ok = await ctx.test.execute({ tenantId: TENANT, actorEmail: ACTOR });
    expect(ok).toMatchObject({
      value: { connection: { status: "connected", lastError: null, version: 2 } },
    });
    expect(ctx.provider.calls.at(-1)?.credentials.apiKey).toBe(STORE_KEY);
    ctx.provider.failNext("EMAIL_RATE_LIMITED", "Too many requests");
    const failed = await ctx.test.execute({ tenantId: TENANT, actorEmail: ACTOR });
    expect(failed).toMatchObject({
      value: { connection: { status: "failed", lastError: "Too many requests", version: 3 } },
    });
  });

  it("'Send test' needs a connection, an actor address and a server that can open keys", async () => {
    expect.hasAssertions();
    const ctx = setup();
    expect(await ctx.test.execute({ tenantId: TENANT, actorEmail: ACTOR })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    await save(ctx);
    expect(await ctx.test.execute({ tenantId: TENANT, actorEmail: null })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(
      await setup({ vault: false }).test.execute({ tenantId: TENANT, actorEmail: ACTOR }),
    ).toMatchObject({ ok: false, error: { code: "NOT_CONFIGURED" } });
  });
});
