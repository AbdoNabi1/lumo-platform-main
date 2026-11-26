import { describe, expect, it } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import type { StoreProfilePort } from "./messaging-ports";
import {
  GetNotificationSettings,
  UpdateNotificationSettings,
} from "./notification-settings.use-cases";
import {
  GetNotificationTemplate,
  ListNotificationTemplates,
  PreviewNotificationTemplate,
  PutNotificationTemplate,
  RevertNotificationTemplate,
  SendTestEmail,
} from "./notification-templates.use-cases";
import {
  InMemoryEmailConnectionRepository,
  InMemoryNotificationSettingsRepository,
  InMemoryTemplateOverrideRepository,
} from "../infrastructure/in-memory-messaging-repositories";
import { STORE_KEY, storeEmailFixture } from "../testing/store-email-fixture";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { NotificationSettingsRepository } from "../domain/messaging/messaging-repositories";

const TENANT = "tenant-a";
const OTHER = "tenant-b";

function setup(options: { configured?: boolean; contactEmail?: string | null } = {}) {
  const settings = new InMemoryNotificationSettingsRepository();
  const overrides = new InMemoryTemplateOverrideRepository();
  const email = storeEmailFixture();
  const store: StoreProfilePort = {
    get: () =>
      Promise.resolve({
        storeName: "Nusuj Store",
        contactEmail:
          options.contactEmail === undefined ? "contact@gmail.com" : options.contactEmail,
        defaultLocale: "ar",
      }),
  };
  const base = { settings, overrides, store };
  const settingsDeps = {
    settings,
    store,
    unitOfWork: new InMemoryUnitOfWork(),
    connections: email.connections,
  };
  const ready = options.configured === false ? Promise.resolve() : email.connect(TENANT);
  return {
    settings,
    overrides,
    email,
    ready,
    sent: email.provider.calls,
    get: new GetNotificationSettings(settingsDeps),
    update: new UpdateNotificationSettings(settingsDeps),
    list: new ListNotificationTemplates(base),
    getTemplate: new GetNotificationTemplate(base),
    put: new PutNotificationTemplate(base),
    revert: new RevertNotificationTemplate(base),
    preview: new PreviewNotificationTemplate(base),
    sendTest: new SendTestEmail({ ...base, mail: email.delivery }),
  };
}

const values = { senderEmail: null, staffRecipients: [], disabledTemplates: [] };

describe("settings", () => {
  it("reads the defaults: no email connection means delivery is not configured", async () => {
    expect.hasAssertions();
    const { get } = setup({ configured: false });
    const result = await get.execute({ tenantId: TENANT });
    expect(result).toMatchObject({
      ok: true,
      value: {
        version: null,
        deliveryConfigured: false,
        emailConnection: "none",
        storeName: "Nusuj Store",
        values: { senderEmail: null, staffRecipients: [], disabledTemplates: [] },
        sender: { mode: "not_connected", effectiveEmail: null, freeMail: false },
      },
    });
  });

  it("deliveryConfigured means a connected, switched-on connection (D46)", async () => {
    expect.hasAssertions();
    const ctx = setup({ configured: false });
    await ctx.email.connect(TENANT, { fromEmail: "Shop@Nusuj.com" });
    expect(await ctx.get.execute({ tenantId: TENANT })).toMatchObject({
      value: {
        deliveryConfigured: true,
        emailConnection: "connected",
        sender: { mode: "store_connection", effectiveEmail: "shop@nusuj.com", freeMail: false },
      },
    });
    // Another store's connection never counts for this one.
    expect(await ctx.get.execute({ tenantId: OTHER })).toMatchObject({
      value: { deliveryConfigured: false, emailConnection: "none" },
    });
  });

  it("a switched-off or failed connection is not delivery either, and says which", async () => {
    expect.hasAssertions();
    const off = setup({ configured: false });
    await off.email.connect(TENANT, { enabled: false });
    expect(await off.get.execute({ tenantId: TENANT })).toMatchObject({
      value: { deliveryConfigured: false, emailConnection: "disabled" },
    });
    const failed = setup({ configured: false });
    await failed.email.connect(TENANT, { status: "failed" });
    expect(await failed.get.execute({ tenantId: TENANT })).toMatchObject({
      value: { deliveryConfigured: false, emailConnection: "failed" },
    });
  });

  it("flags a free-mail From address (an API provider cannot send from it)", async () => {
    expect.hasAssertions();
    const ctx = setup({ configured: false });
    await ctx.email.connect(TENANT, { fromEmail: "shop@gmail.com" });
    expect(await ctx.get.execute({ tenantId: TENANT })).toMatchObject({
      value: { sender: { effectiveEmail: "shop@gmail.com", freeMail: true } },
    });
  });

  it("saves and bumps the version; the stored sender email is kept but is not the From", async () => {
    expect.hasAssertions();
    const { update, get } = setup({ configured: false });
    const saved = await update.execute({
      tenantId: TENANT,
      expectedVersion: null,
      values: { ...values, senderEmail: "Hello@nusuj.com", staffRecipients: ["me@nusuj.com"] },
    });
    expect(saved).toMatchObject({ ok: true, value: { version: 1 } });
    const read = await get.execute({ tenantId: TENANT });
    expect(read).toMatchObject({
      ok: true,
      value: {
        version: 1,
        values: { senderEmail: "hello@nusuj.com", staffRecipients: ["me@nusuj.com"] },
        sender: { mode: "not_connected", effectiveEmail: null },
      },
    });
  });

  it("answers CONFLICT on a stale version and never overwrites", async () => {
    expect.hasAssertions();
    const { update, get } = setup();
    await update.execute({ tenantId: TENANT, expectedVersion: null, values });
    const stale = await update.execute({
      tenantId: TENANT,
      expectedVersion: null,
      values: { ...values, senderEmail: "x@nusuj.com" },
    });
    expect(stale).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const wrong = await update.execute({ tenantId: TENANT, expectedVersion: 7, values });
    expect(wrong).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(await get.execute({ tenantId: TENANT })).toMatchObject({
      value: { version: 1, values: { senderEmail: null } },
    });
  });

  it("maps a ConcurrencyError raised by the write to CONFLICT, outside the unit of work", async () => {
    expect.hasAssertions();
    const racing: NotificationSettingsRepository = {
      find: () => Promise.resolve(null),
      save: () => Promise.reject(new ConcurrencyError("created concurrently")),
    };
    let leftTheUnitOfWork = false;
    const base = {
      settings: racing,
      store: {
        get: () => Promise.resolve({ storeName: "S", contactEmail: null, defaultLocale: null }),
      },
      connections: new InMemoryEmailConnectionRepository(),
      unitOfWork: {
        run: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
          try {
            return await work(undefined);
          } catch (error) {
            leftTheUnitOfWork = true;
            throw error;
          }
        },
      },
    };
    const result = await new UpdateNotificationSettings(base).execute({
      tenantId: TENANT,
      expectedVersion: null,
      values,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(leftTheUnitOfWork).toBe(true);
  });

  it("refuses invalid settings with a 422-class VALIDATION error and writes nothing", async () => {
    expect.hasAssertions();
    const { update, get } = setup();
    const result = await update.execute({
      tenantId: TENANT,
      expectedVersion: null,
      values: { ...values, senderEmail: "not-an-email" },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await get.execute({ tenantId: TENANT })).toMatchObject({ value: { version: null } });
  });

  it("keeps each tenant's settings apart", async () => {
    expect.hasAssertions();
    const { update, get } = setup();
    await update.execute({
      tenantId: TENANT,
      expectedVersion: null,
      values: { ...values, disabledTemplates: ["order_canceled"] },
    });
    expect(await get.execute({ tenantId: OTHER })).toMatchObject({
      value: { version: null, values: { disabledTemplates: [] } },
    });
  });
});

describe("templates", () => {
  it("lists every template with defaults, on by default, in both languages", async () => {
    expect.hasAssertions();
    const { list } = setup();
    const result = await list.execute({ tenantId: TENANT });
    expect(result.ok && result.value.templates.map((t) => t.key)).toEqual([
      "order_confirmation",
      "order_canceled",
      "order_refunded",
      "shipping_confirmation",
      "draft_order_invoice",
      "staff_new_order",
    ]);
    expect(result.ok && result.value.templates.every((t) => t.enabled)).toBe(true);
    expect(result.ok && result.value.templates[0]?.locales.ar.customized).toBe(false);
  });

  it("saves an override, shows it as customized, and reverting deletes it", async () => {
    expect.hasAssertions();
    const { put, getTemplate, revert, overrides } = setup();
    const saved = await put.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "ar",
      subject: "مرحبا {{order_number}}",
      body: "نص {{customer_name}}",
    });
    expect(saved).toMatchObject({
      ok: true,
      value: {
        locale: "ar",
        locales: { ar: { customized: true, subject: "مرحبا {{order_number}}" } },
      },
    });
    expect((await overrides.list(OTHER)).length).toBe(0);
    const en = await getTemplate.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "en",
    });
    expect(en).toMatchObject({ value: { locales: { en: { customized: false } } } });
    const reverted = await revert.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "ar",
    });
    expect(reverted).toMatchObject({ ok: true, value: { locales: { ar: { customized: false } } } });
    expect(
      await revert.execute({ tenantId: TENANT, key: "order_confirmation", locale: "ar" }),
    ).toMatchObject({ ok: true });
  });

  it("refuses an unknown key, an unknown locale and over-long copy", async () => {
    expect.hasAssertions();
    const { put, getTemplate } = setup();
    expect(
      await getTemplate.execute({ tenantId: TENANT, key: "nope", locale: "en" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(
      await put.execute({
        tenantId: TENANT,
        key: "order_canceled",
        locale: "fr",
        subject: "a",
        body: "b",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await put.execute({
        tenantId: TENANT,
        key: "order_canceled",
        locale: "en",
        subject: "a",
        body: "x".repeat(20_001),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("previews with sample data, escaping and reporting unknown variables", async () => {
    expect.hasAssertions();
    const { preview } = setup();
    const result = await preview.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "en",
      subject: "Hello {{order_number}} {{bogus}}",
      body: "<script>x</script> {{customer_name}} {{line_items}}",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { subject: "Hello #1042", unknownVariables: ["bogus"] },
    });
    expect(result.ok && result.value.html).not.toContain("<script>");
    expect(result.ok && result.value.html).toContain("Linen shirt");
  });

  it("previews the saved copy when no draft is sent", async () => {
    expect.hasAssertions();
    const { put, preview } = setup();
    await put.execute({
      tenantId: TENANT,
      key: "order_canceled",
      locale: "en",
      subject: "Gone {{order_number}}",
      body: "bye",
    });
    expect(
      await preview.execute({ tenantId: TENANT, key: "order_canceled", locale: "en" }),
    ).toMatchObject({
      value: { subject: "Gone #1042" },
    });
  });
});

describe("send a test email", () => {
  it("sends only to the actor's own address, through the STORE's account, and marks it a test", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await ctx.ready;
    const result = await ctx.sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "en",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toEqual({ ok: true, value: { sent: true } });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]?.message).toMatchObject({
      to: "staff@nusuj.com",
      from: '"Nusuj Store" <shop@nusuj.com>',
    });
    expect(ctx.sent[0]?.credentials.apiKey).toBe(STORE_KEY);
    expect(ctx.sent[0]?.message.subject.startsWith("[Test] ")).toBe(true);
  });

  it("ignores any recipient in the input: only actorEmail is ever used", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await ctx.ready;
    await ctx.sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
      ...({ to: "victim@example.com" } as object),
    });
    expect(ctx.sent.map((call) => call.message.to)).toEqual(["staff@nusuj.com"]);
  });

  it("no connection / switched off / failed: EMAIL_NOT_CONNECTED (503) and nothing is sent", async () => {
    expect.hasAssertions();
    for (const seed of [undefined, { enabled: false }, { status: "failed" as const }]) {
      const ctx = setup({ configured: false });
      if (seed !== undefined) await ctx.email.connect(TENANT, seed);
      const result = await ctx.sendTest.execute({
        tenantId: TENANT,
        key: "order_confirmation",
        actorEmail: "staff@nusuj.com",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "EMAIL_NOT_CONNECTED" } });
      expect(ctx.sent).toHaveLength(0);
    }
  });

  it("another store's connection is never used for this store's test", async () => {
    expect.hasAssertions();
    const ctx = setup({ configured: false });
    await ctx.email.connect(OTHER);
    const result = await ctx.sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "EMAIL_NOT_CONNECTED" } });
    expect(ctx.sent).toHaveLength(0);
  });

  it("refuses when the actor has no address", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await ctx.ready;
    expect(
      await ctx.sendTest.execute({ tenantId: TENANT, key: "order_confirmation", actorEmail: null }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(ctx.sent).toHaveLength(0);
  });

  it("a refusing provider is PROVIDER_ERROR with the provider's sanitized message: no key, no address", async () => {
    expect.hasAssertions();
    const ctx = setup();
    await ctx.ready;
    ctx.email.provider.failNext(
      "EMAIL_SENDER_REJECTED",
      `The nusuj.com domain is not verified. Sent to staff@nusuj.com with ${STORE_KEY}`,
    );
    const result = await ctx.sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_ERROR", retryable: false },
    });
    const text = result.ok ? "" : `${result.error.message} ${JSON.stringify(result.error)}`;
    expect(text).toContain("domain is not verified");
    expect(text).not.toContain("staff@nusuj.com");
    expect(text).not.toContain(STORE_KEY);
  });
});
