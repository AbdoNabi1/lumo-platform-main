import { describe, expect, it, vi } from "vitest";
import { ConcurrencyError } from "@platform/utils";
import type { EmailDeliveryPort, OutgoingMail, StoreProfilePort } from "./messaging-ports";
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
  InMemoryNotificationSettingsRepository,
  InMemorySenderDomainReader,
  InMemoryTemplateOverrideRepository,
} from "../infrastructure/in-memory-messaging-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { NotificationSettingsRepository } from "../domain/messaging/messaging-repositories";

const TENANT = "tenant-a";
const OTHER = "tenant-b";

function setup(options: { configured?: boolean; contactEmail?: string | null } = {}) {
  const settings = new InMemoryNotificationSettingsRepository();
  const overrides = new InMemoryTemplateOverrideRepository();
  const senderDomains = new InMemorySenderDomainReader();
  const sent: OutgoingMail[] = [];
  const store: StoreProfilePort = {
    get: () =>
      Promise.resolve({
        storeName: "Nusuj Store",
        contactEmail:
          options.contactEmail === undefined ? "contact@gmail.com" : options.contactEmail,
        defaultLocale: "ar",
      }),
  };
  const delivery: EmailDeliveryPort = {
    deliveryConfigured: options.configured ?? true,
    platformFrom: "Morbeh <onboarding@resend.dev>",
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  const base = { settings, overrides, store, senderDomains, platformFrom: delivery.platformFrom };
  const settingsDeps = {
    ...base,
    unitOfWork: new InMemoryUnitOfWork(),
    deliveryConfigured: delivery.deliveryConfigured,
  };
  return {
    settings,
    overrides,
    senderDomains,
    sent,
    delivery,
    get: new GetNotificationSettings(settingsDeps),
    update: new UpdateNotificationSettings(settingsDeps),
    list: new ListNotificationTemplates(base),
    getTemplate: new GetNotificationTemplate(base),
    put: new PutNotificationTemplate(base),
    revert: new RevertNotificationTemplate(base),
    preview: new PreviewNotificationTemplate(base),
    sendTest: new SendTestEmail({ ...base, delivery }),
  };
}

const values = { senderEmail: null, staffRecipients: [], disabledTemplates: [] };

describe("settings", () => {
  it("reads the defaults with deliveryConfigured and the reply-to sender summary", async () => {
    expect.hasAssertions();
    const { get } = setup({ configured: false });
    const result = await get.execute({ tenantId: TENANT });
    expect(result).toMatchObject({
      ok: true,
      value: {
        version: null,
        deliveryConfigured: false,
        storeName: "Nusuj Store",
        values: { senderEmail: null, staffRecipients: [], disabledTemplates: [] },
        sender: { mode: "reply_to", effectiveEmail: "contact@gmail.com", freeMail: true },
      },
    });
  });

  it("saves, bumps the version, and shows an own-domain sender once its domain is verified", async () => {
    expect.hasAssertions();
    const { update, get, senderDomains } = setup();
    const saved = await update.execute({
      tenantId: TENANT,
      expectedVersion: null,
      values: { ...values, senderEmail: "Hello@nusuj.com", staffRecipients: ["me@nusuj.com"] },
    });
    expect(saved).toMatchObject({ ok: true, value: { version: 1, sender: { mode: "reply_to" } } });
    senderDomains.setVerified(TENANT, ["nusuj.com"]);
    const read = await get.execute({ tenantId: TENANT });
    expect(read).toMatchObject({
      ok: true,
      value: {
        version: 1,
        values: { senderEmail: "hello@nusuj.com", staffRecipients: ["me@nusuj.com"] },
        sender: { mode: "own_domain", effectiveEmail: "hello@nusuj.com", freeMail: false },
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
      senderDomains: new InMemorySenderDomainReader(),
      platformFrom: "M <a@b.co>",
      deliveryConfigured: true,
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
  it("sends only to the actor's own address, with the real sender resolution, and marks it a test", async () => {
    expect.hasAssertions();
    const { sendTest, sent } = setup();
    const result = await sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "en",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toEqual({ ok: true, value: { sent: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "staff@nusuj.com",
      from: '"Nusuj Store" <onboarding@resend.dev>',
      replyTo: "contact@gmail.com",
    });
    expect(sent[0]?.subject.startsWith("[Test] ")).toBe(true);
  });

  it("ignores any recipient in the input: only actorEmail is ever used", async () => {
    expect.hasAssertions();
    const { sendTest, sent } = setup();
    await sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
      ...({ to: "victim@example.com" } as object),
    });
    expect(sent.map((m) => m.to)).toEqual(["staff@nusuj.com"]);
  });

  it("answers NOT_CONFIGURED (503) and sends nothing when the runtime has no real provider", async () => {
    expect.hasAssertions();
    const { sendTest, sent } = setup({ configured: false });
    const result = await sendTest.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_CONFIGURED" } });
    expect(sent).toHaveLength(0);
  });

  it("refuses when the actor has no address and when the provider fails (no address in the error)", async () => {
    expect.hasAssertions();
    const ctx = setup();
    expect(
      await ctx.sendTest.execute({ tenantId: TENANT, key: "order_confirmation", actorEmail: null }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    const failing = new SendTestEmail({
      settings: ctx.settings,
      overrides: ctx.overrides,
      store: {
        get: () => Promise.resolve({ storeName: "S", contactEmail: null, defaultLocale: null }),
      },
      senderDomains: ctx.senderDomains,
      platformFrom: ctx.delivery.platformFrom,
      delivery: {
        ...ctx.delivery,
        send: vi.fn(() => Promise.reject(new Error("provider said no to staff@nusuj.com"))),
      },
    });
    const result = await failing.execute({
      tenantId: TENANT,
      key: "order_confirmation",
      actorEmail: "staff@nusuj.com",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "BUSINESS_RULE" } });
    expect(JSON.stringify(result)).not.toContain("staff@nusuj.com");
  });
});
