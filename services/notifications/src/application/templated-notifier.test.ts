import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireNotifications } from "../composition";
import type { Notification } from "../domain/notification";
import type { OutgoingMail } from "./messaging-ports";
import { staffRecipientRef } from "./staff-recipient-ref";

const TENANT = "tenant-a";
const clock: Clock = { now: () => new Date("2026-11-26T10:00:00.000Z") };

function ids(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

interface Options {
  readonly configured?: boolean;
  readonly language?: string | null;
  readonly sendError?: Error;
  readonly storeLocale?: string | null;
  readonly contactEmail?: string | null;
  readonly verified?: readonly string[];
  readonly customers?: Record<string, { name: string; email: string; language: string | null }>;
}

function setup(options: Options = {}) {
  const sent: OutgoingMail[] = [];
  const logs: { message: string; fields?: unknown }[] = [];
  const customers = options.customers ?? {
    "cust-1": { name: "Sara", email: "sara@customer.test", language: options.language ?? null },
  };
  const app = wireNotifications(
    { serializer: new InMemoryEventSerializer(), idGenerator: ids(), clock },
    {
      store: {
        get: () =>
          Promise.resolve({
            storeName: "Nusuj Store",
            contactEmail:
              options.contactEmail === undefined ? "shop@gmail.com" : options.contactEmail,
            defaultLocale: options.storeLocale === undefined ? "en" : options.storeLocale,
          }),
      },
      delivery: {
        deliveryConfigured: options.configured ?? true,
        platformFrom: "Morbeh <onboarding@resend.dev>",
        send: (message) => {
          if (options.sendError !== undefined) return Promise.reject(options.sendError);
          sent.push(message);
          return Promise.resolve();
        },
      },
      senderDomains: { listVerifiedDomains: () => Promise.resolve(options.verified ?? []) },
      recipients: { resolve: (_tenant, ref) => Promise.resolve(customers[ref] ?? null) },
      log: { warn: (message, fields) => void logs.push({ message, fields }) },
    },
  );
  return { app, sent, logs };
}

const ORDER_JSON = JSON.stringify({
  lines: [{ name: "<script>alert(1)</script> Shirt", quantity: 2, unitAmountMinor: 45000 }],
  subtotalMinor: 90000,
  totalMinor: 95000,
});

const orderVars = {
  order_number: "#1042",
  currency: "EGP",
  total_minor: "95000",
  order_json: ORDER_JSON,
};

function request(
  overrides: Partial<Parameters<ReturnType<typeof setup>["app"]["notifier"]["execute"]>[0]> = {},
) {
  return {
    tenantId: TENANT,
    template: "order_confirmation" as const,
    eventKey: "order-1",
    sourceRef: "orders:#1042",
    recipientRef: "cust-1",
    variables: orderVars,
    ...overrides,
  };
}

async function row(
  app: ReturnType<typeof setup>["app"],
  notificationId: string,
): Promise<Notification> {
  const response = await app.notifications.get({ tenantId: TENANT, notificationId });
  return response.body as Notification;
}

describe("TemplatedNotifier + TemplatedEmailProvider (Wave 2b)", () => {
  it("sends the confirmation once: store name as From, merchant address as Reply-To, escaped HTML", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const result = await app.notifier.execute(request());
    expect(result).toMatchObject({ ok: true, value: { status: "sent", deduplicated: false } });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail).toMatchObject({
      to: "sara@customer.test",
      from: '"Nusuj Store" <onboarding@resend.dev>',
      replyTo: "shop@gmail.com",
    });
    expect(mail.subject).toBe("Order #1042 confirmed");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Shirt");
    expect(mail.text).toContain("Hi Sara");
    expect(mail.idempotencyKey).toMatch(/:attempt:0$/);
  });

  it("a retried event never mails twice (idempotent)", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    await app.notifier.execute(request());
    const again = await app.notifier.execute(request());
    expect(again).toMatchObject({ ok: true, value: { status: "sent", deduplicated: true } });
    expect(sent).toHaveLength(1);
    await app.notifier.execute(request({ eventKey: "order-2" }));
    expect(sent).toHaveLength(2);
  });

  it("uses the verified own domain as From, and no Reply-To", async () => {
    expect.hasAssertions();
    const { app, sent } = setup({ contactEmail: "hello@nusuj.com", verified: ["nusuj.com"] });
    await app.notifier.execute(request());
    expect(sent[0]).toMatchObject({ from: '"Nusuj Store" <hello@nusuj.com>' });
    expect("replyTo" in sent[0]!).toBe(false);
  });

  it("writes in the customer's language, else the store's default, and uses the merchant's override", async () => {
    expect.hasAssertions();
    const arabic = setup({ language: "ar" });
    await arabic.app.notifier.execute(request());
    expect(arabic.sent[0]!.subject).toBe("تم تأكيد طلبك #1042");
    expect(arabic.sent[0]!.html).toContain('dir="rtl"');

    const storeDefault = setup({ language: null, storeLocale: "ar" });
    await storeDefault.app.notifier.execute(request());
    expect(storeDefault.sent[0]!.subject).toBe("تم تأكيد طلبك #1042");

    const english = setup({ language: "fr", storeLocale: null });
    await english.app.notifier.execute(request());
    expect(english.sent[0]!.subject).toBe("Order #1042 confirmed");

    const custom = setup();
    await custom.app.settings.putTemplate({
      tenantId: TENANT,
      key: "order_confirmation",
      locale: "en",
      subject: "Thanks {{customer_name}}!",
      body: "We got {{order_number}} ({{order_total}}).",
    });
    await custom.app.notifier.execute(request());
    expect(custom.sent[0]!.subject).toBe("Thanks Sara!");
    expect(custom.sent[0]!.text).toMatch(/^We got #1042 \(.*950\.00.*\)\.$/);
  });

  it("a switched-off template sends nothing and leaves a cancelled row with reason DISABLED", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    await app.settings.updateSettings({
      tenantId: TENANT,
      expectedVersion: null,
      values: { senderEmail: null, staffRecipients: [], disabledTemplates: ["order_confirmation"] },
    });
    const result = await app.notifier.execute(request());
    expect(result).toMatchObject({ ok: true, value: { status: "cancelled", deduplicated: false } });
    expect(sent).toHaveLength(0);
    const id = result.ok ? result.value.notificationId : "";
    const notification = await row(app, id);
    const last = notification.history.at(-1);
    expect(last?.status).toBe("cancelled");
    expect(last?.reason).toBe("DISABLED");
    // a replay of the same event stays cancelled and quiet
    expect(await app.notifier.execute(request())).toMatchObject({
      ok: true,
      value: { deduplicated: true },
    });
  });

  it("with no real provider every notification is failed EMAIL_NOT_CONFIGURED, never sent", async () => {
    expect.hasAssertions();
    const { app, sent } = setup({ configured: false });
    const result = await app.notifier.execute(request());
    expect(result).toMatchObject({ ok: true, value: { status: "failed" } });
    expect(sent).toHaveLength(0);
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    expect(notification.attempts.at(-1)?.providerRef).toBe("EMAIL_NOT_CONFIGURED");
    expect(notification.history.at(-1)?.reason).toBe("EMAIL_NOT_CONFIGURED");
  });

  it("a provider failure is recorded as a short code: no address, no body, nothing leaks to the log", async () => {
    expect.hasAssertions();
    const { app, logs } = setup({
      sendError: new Error("550 mailbox sara@customer.test rejected: Hi Sara body"),
    });
    const result = await app.notifier.execute(request());
    expect(result).toMatchObject({ ok: true, value: { status: "failed" } });
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    expect(notification.attempts.at(-1)?.providerRef).toBe("EMAIL_SEND_FAILED");
    const everything = JSON.stringify({ logs, history: notification.history.map((h) => h.reason) });
    expect(everything).not.toContain("sara@customer.test");
    expect(everything).not.toContain("Hi Sara");
    expect(logs).toEqual([
      {
        message: "notification email not sent",
        fields: { template: "order_confirmation", reason: "EMAIL_SEND_FAILED" },
      },
    ]);
  });

  it("stores no address and no rendered body on the notification row", async () => {
    expect.hasAssertions();
    const { app } = setup();
    const result = await app.notifier.execute(request());
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    const stored = JSON.stringify({
      recipient: notification.recipient.customerRef,
      template: notification.template,
      variables: notification.variables,
      attempts: notification.attempts.map((a) => a.providerRef),
    });
    expect(stored).not.toContain("@");
    expect(stored).not.toContain("Thanks for your order");
    expect(stored).not.toContain("Sara");
    expect(notification.template.bodyPattern).toBe("[[order_confirmation]]");
  });

  it("fails RECIPIENT_NOT_FOUND for an unknown customer and sends nothing", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const result = await app.notifier.execute(request({ recipientRef: "ghost" }));
    expect(result).toMatchObject({ ok: true, value: { status: "failed" } });
    expect(sent).toHaveLength(0);
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    expect(notification.attempts.at(-1)?.providerRef).toBe("RECIPIENT_NOT_FOUND");
  });

  it("draft invoice: the link is used for the send and never stored; without it the send fails", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const link = "https://shop.example/c/SECRET-TOKEN";
    const result = await app.notifier.execute(
      request({
        template: "draft_order_invoice",
        eventKey: "draft-1:2026-12-26",
        sourceRef: "draft:d-1",
        variables: { currency: "EGP", total_minor: "95000", order_json: ORDER_JSON },
        transient: { invoice_url: link },
      }),
    );
    expect(result).toMatchObject({ ok: true, value: { status: "sent" } });
    expect(sent[0]!.text).toContain(link);
    expect(sent[0]!.html).toContain(`href="${link}"`);
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    expect(JSON.stringify(notification.variables)).not.toContain("SECRET-TOKEN");

    const missing = await app.notifier.execute(
      request({ template: "draft_order_invoice", eventKey: "draft-2", variables: orderVars }),
    );
    expect(missing).toMatchObject({ ok: true, value: { status: "failed" } });
    const failed = await row(app, missing.ok ? missing.value.notificationId : "");
    expect(failed.attempts.at(-1)?.providerRef).toBe("MISSING_VARIABLE");
  });

  it("a draft with no customer record is mailed at the one-off address that exists only for the send", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const result = await app.notifier.execute(
      request({
        template: "draft_order_invoice",
        eventKey: "draft-3",
        recipientRef: "draft:d-3",
        transient: {
          invoice_url: "https://shop.example/c/t",
          recipient_email: "guest@buyer.test",
          recipient_name: "Guest",
        },
      }),
    );
    expect(sent[0]!.to).toBe("guest@buyer.test");
    const notification = await row(app, result.ok ? result.value.notificationId : "");
    expect(JSON.stringify(notification)).not.toContain("guest@buyer.test");
  });

  it("staff new order: one mail per configured recipient, addressed by hash on the rows", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    await app.settings.updateSettings({
      tenantId: TENANT,
      expectedVersion: null,
      values: {
        senderEmail: null,
        staffRecipients: ["owner@shop.test", "ops@shop.test"],
        disabledTemplates: [],
      },
    });
    const results = await app.notifier.executeForStaff({
      tenantId: TENANT,
      template: "staff_new_order",
      eventKey: "order-1",
      sourceRef: "orders:#1042",
      variables: { ...orderVars, customer_ref: "cust-1" },
    });
    expect(results).toHaveLength(2);
    expect(sent.map((m) => m.to).sort()).toEqual(["ops@shop.test", "owner@shop.test"]);
    expect(sent[0]!.subject).toBe("New order #1042 on Nusuj Store");
    expect(sent[0]!.text).toContain("Sara placed order #1042");
    const first = results[0]!;
    const notification = await row(app, first.ok ? first.value.notificationId : "");
    expect(notification.recipient.customerRef).toBe(staffRecipientRef("owner@shop.test"));
    expect(JSON.stringify(notification.recipient)).not.toContain("@");

    // the same event again: nothing new
    await app.notifier.executeForStaff({
      tenantId: TENANT,
      template: "staff_new_order",
      eventKey: "order-1",
      sourceRef: "orders:#1042",
      variables: { ...orderVars, customer_ref: "cust-1" },
    });
    expect(sent).toHaveLength(2);
  });

  it("staff new order with nobody configured records nothing", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const results = await app.notifier.executeForStaff({
      tenantId: TENANT,
      template: "staff_new_order",
      eventKey: "order-9",
      sourceRef: "orders:#9",
      variables: orderVars,
    });
    expect(results).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("a staff recipient removed after the row was created fails RECIPIENT_NOT_FOUND", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    const result = await app.notifier.execute({
      ...request({ template: "staff_new_order" }),
      recipientRef: staffRecipientRef("gone@shop.test"),
    });
    expect(result).toMatchObject({ ok: true, value: { status: "failed" } });
    expect(sent).toHaveLength(0);
  });

  it("keeps each tenant's mail, settings and templates apart", async () => {
    expect.hasAssertions();
    const { app, sent } = setup();
    await app.settings.putTemplate({
      tenantId: "tenant-b",
      key: "order_confirmation",
      locale: "en",
      subject: "B only",
      body: "B",
    });
    await app.notifier.execute(request());
    expect(sent[0]!.subject).toBe("Order #1042 confirmed");
  });
});
