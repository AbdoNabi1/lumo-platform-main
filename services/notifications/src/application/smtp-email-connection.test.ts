import { describe, expect, it } from "vitest";
import { smtpSecrets } from "../domain/messaging/email-connection";
import { InMemoryEmailConnectionRepository } from "../infrastructure/in-memory-messaging-repositories";
import { InMemoryStoreEmailProvider } from "../infrastructure/in-memory-store-email-provider";
import { testEmailVault } from "../testing/email-connection-doubles";
import { FIXED_NOW, fixedClock } from "../testing/store-email-fixture";
import {
  GetEmailConnection,
  SaveEmailConnection,
  TestEmailConnection,
} from "./email-connection.use-cases";
import type { StoreProfilePort } from "./messaging-ports";
import { StoreEmailDelivery, StoreEmailError } from "./store-email-delivery";

const TENANT = "tenant-a";
const ACTOR = "staff@nusuj.com";
const PASSWORD = "abcdefghijklmnop";
const GMAIL = { preset: "gmail", username: "shop@gmail.com" };

const store: StoreProfilePort = {
  get: () => Promise.resolve({ storeName: "Nusuj Store", contactEmail: null, defaultLocale: "en" }),
};

function setup(options: { smtpEnabled?: boolean } = {}) {
  const connections = new InMemoryEmailConnectionRepository();
  const provider = new InMemoryStoreEmailProvider();
  const vault = testEmailVault();
  const deps = {
    connections,
    store,
    clock: fixedClock,
    vault,
    provider,
    smtpEnabled: options.smtpEnabled ?? true,
  };
  return {
    connections,
    provider,
    vault,
    get: new GetEmailConnection(deps),
    save: new SaveEmailConnection(deps),
    test: new TestEmailConnection(deps),
    delivery: new StoreEmailDelivery({
      connections,
      vault,
      provider,
      clock: fixedClock,
      smtpEnabled: options.smtpEnabled ?? true,
    }),
  };
}

function save(
  ctx: ReturnType<typeof setup>,
  overrides: Record<string, unknown> = {},
  expectedVersion: number | null = null,
) {
  return ctx.save.execute({
    tenantId: TENANT,
    expectedVersion,
    actorEmail: ACTOR,
    kind: "smtp",
    fromEmail: "Shop@Gmail.com",
    apiKey: null,
    smtp: GMAIL,
    password: PASSWORD,
    ...overrides,
  });
}

describe("SMTP connection: the server flag (EMAIL_SMTP_ENABLED)", () => {
  it("off: saving a mailbox answers NOT_CONFIGURED, stores nothing and calls nobody", async () => {
    const ctx = setup({ smtpEnabled: false });
    const result = await save(ctx);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_CONFIGURED" } });
    expect(await ctx.connections.find(TENANT)).toBeNull();
    expect(ctx.provider.calls).toEqual([]);
    expect(await ctx.get.execute({ tenantId: TENANT })).toMatchObject({
      value: { smtpAvailable: false, credentialsConfigured: true },
    });
  });

  it("on: the read says smtpAvailable", async () => {
    expect(await setup().get.execute({ tenantId: TENANT })).toMatchObject({
      value: { smtpAvailable: true, connection: null },
    });
  });

  it("Resend still works with the flag off", async () => {
    const ctx = setup({ smtpEnabled: false });
    const result = await save(ctx, {
      kind: "resend",
      smtp: undefined,
      password: undefined,
      apiKey: "re_store_xxxxxxxxxxxxxxxxxxxx1234",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { connection: { kind: "resend", smtp: null } },
    });
  });
});

describe("SMTP connection: saving", () => {
  it("seals host, port, security, username and password; tests through the mailbox; shows no password", async () => {
    const ctx = setup();
    const result = await save(ctx, { password: "abcd efgh ijkl mnop" });
    expect(result).toMatchObject({
      ok: true,
      value: {
        smtpAvailable: true,
        connection: {
          kind: "smtp",
          fromEmail: "shop@gmail.com",
          secretLast4: "",
          status: "connected",
          state: "connected",
          lastError: null,
          lastErrorCode: null,
          verifiedAt: FIXED_NOW.toISOString(),
          version: 1,
          smtp: {
            preset: "gmail",
            host: "smtp.gmail.com",
            port: 465,
            security: "tls",
            username: "shop@gmail.com",
          },
        },
      },
    });
    // The spaces Google shows in an app password are not part of it.
    expect(ctx.provider.calls[0]?.credentials).toEqual({
      kind: "smtp",
      apiKey: PASSWORD,
      smtp: { host: "smtp.gmail.com", port: 465, security: "tls", username: "shop@gmail.com" },
    });
    expect(ctx.provider.calls[0]?.message).toMatchObject({
      to: ACTOR,
      from: '"Nusuj Store" <shop@gmail.com>',
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);

    const row = await ctx.connections.find(TENANT);
    expect(row?.sealedCredentials).not.toContain(PASSWORD);
    expect(row?.sealedCredentials).not.toContain("smtp.gmail.com");
    expect(await ctx.vault.open(TENANT, "smtp", row?.sealedCredentials ?? "")).toEqual(
      smtpSecrets(
        { host: "smtp.gmail.com", port: 465, security: "tls", username: "shop@gmail.com" },
        PASSWORD,
      ),
    );
  });

  it("applies each preset's server", async () => {
    const outlook = setup();
    await save(outlook, {
      fromEmail: "me@outlook.com",
      smtp: { preset: "outlook", username: "me@outlook.com" },
    });
    expect(outlook.provider.calls[0]?.credentials.smtp).toMatchObject({
      host: "smtp-mail.outlook.com",
      port: 587,
      security: "starttls",
    });
    const zoho = setup();
    await save(zoho, {
      fromEmail: "me@zoho.com",
      smtp: { preset: "zoho", username: "me@zoho.com" },
    });
    expect(zoho.provider.calls[0]?.credentials.smtp).toMatchObject({
      host: "smtp.zoho.com",
      port: 465,
      security: "tls",
    });
  });

  it("a preset ignores any server details in the request (they can't redirect the password)", async () => {
    const ctx = setup();
    await save(ctx, {
      smtp: { ...GMAIL, host: "smtp.evil.example", port: 25, security: "starttls" },
    });
    expect(ctx.provider.calls[0]?.credentials.smtp).toMatchObject({
      host: "smtp.gmail.com",
      port: 465,
      security: "tls",
    });
  });

  it("presets need the From address to be the mailbox itself; custom does not", async () => {
    const ctx = setup();
    const refused = await save(ctx, { fromEmail: "orders@gmail.com" });
    expect(refused).toMatchObject({
      ok: false,
      error: { fields: [{ field: "fromEmail" }] },
    });
    expect(ctx.provider.calls).toEqual([]);

    const custom = await save(ctx, {
      fromEmail: "orders@nusuj.com",
      smtp: {
        preset: "custom",
        host: "Mail.Nusuj.com",
        port: 587,
        security: "starttls",
        username: "mailer",
      },
    });
    expect(custom).toMatchObject({
      ok: true,
      value: {
        connection: {
          fromEmail: "orders@nusuj.com",
          smtp: {
            preset: "custom",
            host: "mail.nusuj.com",
            port: 587,
            security: "starttls",
            username: "mailer",
          },
        },
      },
    });
  });

  it("refuses hosts that are not mail servers, odd ports, and missing pieces", async () => {
    const custom = (extra: Record<string, unknown>) => ({
      fromEmail: "orders@nusuj.com",
      smtp: {
        preset: "custom",
        host: "mail.nusuj.com",
        port: 465,
        security: "tls",
        username: "u",
        ...extra,
      },
    });
    const cases: [string, Record<string, unknown>, string][] = [
      ["localhost", custom({ host: "localhost" }), "smtp.host"],
      ["an IP address", custom({ host: "10.0.0.5" }), "smtp.host"],
      ["a host with a path", custom({ host: "mail.nusuj.com/x" }), "smtp.host"],
      ["a host with CRLF", custom({ host: "mail.nusuj.com\r\nRCPT TO:<x@y.z>" }), "smtp.host"],
      ["port 22", custom({ port: 22 }), "smtp.port"],
      ["a string port", custom({ port: "465" }), "smtp.port"],
      ["no security", custom({ security: "none" }), "smtp.security"],
      ["no username", custom({ username: "  " }), "smtp.username"],
      ["an unknown preset", { smtp: { preset: "yahoo", username: "u" } }, "smtp.preset"],
      ["no smtp block", { smtp: undefined }, "smtp"],
      ["a CRLF password", { ...custom({}), password: "abc\r\ndef" }, "password"],
      ["a very long password", { password: "x".repeat(300) }, "password"],
    ];
    for (const [label, overrides, field] of cases) {
      const ctx = setup();
      const result = await save(ctx, overrides);
      expect(result.ok, label).toBe(false);
      expect(JSON.stringify(result), label).toContain(`"field":"${field}"`);
      expect(ctx.provider.calls, label).toEqual([]);
      expect(await ctx.connections.find(TENANT), label).toBeNull();
    }
  });

  it("a first save needs a password", async () => {
    const result = await save(setup(), { password: null });
    expect(result).toMatchObject({ ok: false, error: { fields: [{ field: "password" }] } });
  });

  it("a failed test is saved as failed with the fixed code, never the password", async () => {
    const ctx = setup();
    ctx.provider.failNext(
      "EMAIL_AUTH_FAILED",
      `AUTH_FAILED: The mail server didn't accept the username or password. ${PASSWORD}`,
    );
    const result = await save(ctx);
    expect(result).toMatchObject({
      ok: true,
      value: { connection: { status: "failed", state: "failed", lastErrorCode: "AUTH_FAILED" } },
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect((await ctx.connections.find(TENANT))?.lastError).not.toContain(PASSWORD);
  });

  it("a provider that throws is a failed test that carries nothing it threw", async () => {
    const ctx = setup();
    ctx.provider.throwNext();
    const result = await save(ctx);
    expect(result).toMatchObject({ ok: true, value: { connection: { status: "failed" } } });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("keeps the saved password only for the same server and user", async () => {
    const ctx = setup();
    await save(ctx, {
      fromEmail: "orders@nusuj.com",
      smtp: {
        preset: "custom",
        host: "mail.nusuj.com",
        port: 465,
        security: "tls",
        username: "mailer",
      },
    });

    const sameServer = await save(
      ctx,
      {
        fromEmail: "orders@nusuj.com",
        password: null,
        smtp: {
          preset: "custom",
          host: "mail.nusuj.com",
          port: 587,
          security: "starttls",
          username: "Mailer",
        },
      },
      1,
    );
    expect(sameServer).toMatchObject({
      ok: true,
      value: { connection: { version: 2, smtp: { port: 587, security: "starttls" } } },
    });
    expect(ctx.provider.calls.at(-1)?.credentials.apiKey).toBe(PASSWORD);

    const otherHost = await save(
      ctx,
      {
        fromEmail: "orders@nusuj.com",
        password: null,
        smtp: {
          preset: "custom",
          host: "mail.evil.example",
          port: 465,
          security: "tls",
          username: "mailer",
        },
      },
      2,
    );
    expect(otherHost).toMatchObject({ ok: false, error: { fields: [{ field: "password" }] } });
    const otherUser = await save(
      ctx,
      {
        fromEmail: "orders@nusuj.com",
        password: null,
        smtp: {
          preset: "custom",
          host: "mail.nusuj.com",
          port: 465,
          security: "tls",
          username: "someone-else",
        },
      },
      2,
    );
    expect(otherUser).toMatchObject({ ok: false, error: { fields: [{ field: "password" }] } });
    expect(ctx.provider.calls.map((call) => call.credentials.smtp?.host)).not.toContain(
      "mail.evil.example",
    );
  });

  it("switching from Resend never carries its key over as a password", async () => {
    const ctx = setup();
    await save(ctx, {
      kind: "resend",
      smtp: undefined,
      password: undefined,
      apiKey: "re_store_xxxxxxxxxxxxxxxxxxxx1234",
    });
    const result = await save(ctx, { password: null }, 1);
    expect(result).toMatchObject({ ok: false, error: { fields: [{ field: "password" }] } });
  });

  it("Send test re-tests through the mailbox, and is refused when the flag is off", async () => {
    const ctx = setup();
    await save(ctx);
    ctx.provider.failNext(
      "EMAIL_CONNECTION_FAILED",
      "CONNECTION_FAILED: We couldn't reach the mail server.",
    );
    const failed = await ctx.test.execute({ tenantId: TENANT, actorEmail: ACTOR });
    expect(failed).toMatchObject({
      value: { connection: { status: "failed", lastErrorCode: "CONNECTION_FAILED" } },
    });
    const again = await ctx.test.execute({ tenantId: TENANT, actorEmail: ACTOR });
    expect(again).toMatchObject({ value: { connection: { status: "connected" } } });

    const off = new TestEmailConnection({
      connections: ctx.connections,
      store,
      clock: fixedClock,
      vault: ctx.vault,
      provider: ctx.provider,
      smtpEnabled: false,
    });
    const calls = ctx.provider.calls.length;
    expect(await off.execute({ tenantId: TENANT, actorEmail: ACTOR })).toMatchObject({
      ok: false,
      error: { code: "NOT_CONFIGURED" },
    });
    expect(ctx.provider.calls).toHaveLength(calls);
  });
});

describe("SMTP connection: delivery of a store's customer mail", () => {
  const mail = {
    to: "sara@customer.test",
    subject: "Order #1 confirmed",
    text: "Thanks",
    html: "<p>Thanks</p>",
    idempotencyKey: "n-1:attempt:0",
  };

  it("sends through the store's mailbox with its own server and password", async () => {
    const ctx = setup();
    await save(ctx);
    await ctx.delivery.send(TENANT, "Nusuj Store", mail);
    expect(ctx.provider.calls.at(-1)?.credentials).toMatchObject({
      kind: "smtp",
      apiKey: PASSWORD,
      smtp: { host: "smtp.gmail.com" },
    });
    expect(ctx.provider.calls.at(-1)?.message).toMatchObject({
      from: '"Nusuj Store" <shop@gmail.com>',
      idempotencyKey: "n-1:attempt:0",
    });
    expect(await ctx.delivery.isConnected(TENANT)).toBe(true);
  });

  it("flag off: an existing mailbox connection is as good as none, and nothing is called", async () => {
    const ctx = setup();
    await save(ctx);
    const calls = ctx.provider.calls.length;
    const off = new StoreEmailDelivery({
      connections: ctx.connections,
      vault: ctx.vault,
      provider: ctx.provider,
      clock: fixedClock,
    });
    await expect(off.send(TENANT, "Nusuj Store", mail)).rejects.toMatchObject({
      code: "EMAIL_NOT_CONNECTED",
    });
    expect(await off.isConnected(TENANT)).toBe(false);
    expect(ctx.provider.calls).toHaveLength(calls);
  });

  it("a mailbox refusal is recorded as its fixed code and sanitized text on the connection", async () => {
    const ctx = setup();
    await save(ctx);
    ctx.provider.failNext(
      "EMAIL_DAILY_LIMIT",
      `DAILY_LIMIT: The mailbox reached its sending limit for now. Try again later. sara@customer.test ${PASSWORD}`,
    );
    const error = await ctx.delivery.send(TENANT, "Nusuj Store", mail).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StoreEmailError);
    expect((error as StoreEmailError).code).toBe("EMAIL_DAILY_LIMIT");
    expect((error as StoreEmailError).message).toBe("EMAIL_DAILY_LIMIT");
    const row = await ctx.connections.find(TENANT);
    expect(row?.lastError).toMatch(/^DAILY_LIMIT: /);
    expect(row?.lastError).not.toContain("sara@customer.test");
    expect(row?.lastError).not.toContain(PASSWORD);
  });
});
