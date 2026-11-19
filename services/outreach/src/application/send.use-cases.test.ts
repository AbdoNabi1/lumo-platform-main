import { ConflictError, ValidationError } from "@platform/utils";
import { describe, expect, it } from "vitest";
import type { OutboundRecord } from "../domain/repositories";
import { MetaGraphClient } from "../infrastructure/meta-graph-client";
import { deferred, flush } from "../testing/fake-ports";
import {
  createOutreachKit,
  metaTemplate,
  seedConnection,
  seedContact,
  seedSendScenario,
  seedTemplate,
  T1,
  T2,
  type OutreachKit,
} from "../testing/outreach-kit";
import { errorOf, okValue } from "../testing/result-helpers";
import { messagesPayload, seconds, statusItem } from "../testing/webhook-fixtures";
import { createMetaFetchHarness } from "../testing/meta-fetch-harness";
import { ReconcileUnresolvedOutbound } from "./reconcile-unresolved.use-case";
import {
  SendEmail,
  SendWhatsAppSessionMessage,
  SendWhatsAppTemplate,
  type SendEmailInput,
} from "./send.use-cases";
import { ProcessWhatsAppWebhook } from "./webhook.use-case";

const templateInput = (over: Record<string, unknown> = {}) => ({
  tenantId: T1,
  to: "01012345678",
  templateName: "cod_confirmation_ar",
  language: "ar",
  values: { body: ["Sara"] },
  idempotencyKey: "k1",
  ...over,
});
const sendTemplate = (kit: OutreachKit, over: Record<string, unknown> = {}) =>
  new SendWhatsAppTemplate(kit.deps).execute(templateInput(over));

const sessionInput = (over: Record<string, unknown> = {}) => ({
  tenantId: T1,
  to: "01012345678",
  text: "Your order is ready",
  idempotencyKey: "s1",
  ...over,
});
const sendSession = (kit: OutreachKit, over: Record<string, unknown> = {}) =>
  new SendWhatsAppSessionMessage(kit.deps).execute(sessionInput(over));

const emailInput = (over: Partial<SendEmailInput> = {}): SendEmailInput => ({
  tenantId: T1,
  to: "Buyer@Shop.test",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  purpose: "transactional",
  idempotencyKey: "e1",
  ...over,
});
const sendEmail = (kit: OutreachKit, over: Partial<SendEmailInput> = {}) =>
  new SendEmail(kit.deps).execute(emailInput(over));

/** Runs `fn` right after the first unit of work (the reservation) commits. */
function afterReservation(kit: OutreachKit, fn: () => Promise<void> | void): void {
  const inner = kit.deps.unitOfWork;
  let n = 0;
  kit.deps.unitOfWork = {
    run: async (tenantId, work) => {
      const result = await inner.run(tenantId, work);
      n += 1;
      if (n === 1) await fn();
      return result;
    },
  };
}

function failOutboundUpdateWhen(kit: OutreachKit, flag: { fail: boolean }): void {
  const real = kit.mem.outbound;
  kit.deps.outbound = new Proxy(real, {
    get(target, prop) {
      if (prop === "update") {
        return (...args: Parameters<typeof real.update>) =>
          flag.fail ? Promise.reject(new Error("db down")) : target.update(...args);
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

const allOutbound = (kit: OutreachKit): OutboundRecord[] => kit.mem.store.outbound.values();

describe("SendWhatsAppTemplate — happy path and replay", () => {
  it("sends once: components, correlation, dispatch assets, accepted event and acceptedAt", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const dto = okValue(await sendTemplate(kit));
    expect(dto).toMatchObject({
      status: "accepted",
      providerMessageId: "wamid.1",
      errorCode: null,
    });
    expect(dto.acceptedAt).toBe(kit.clock.now().toISOString());
    const [phone, token, message] = kit.whatsapp.callsOf("sendTemplate")[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(phone).toBe("phone-1");
    expect(token).toBe("token-seed");
    expect(message).toMatchObject({
      to: "+201012345678",
      name: "cod_confirmation_ar",
      language: "ar",
      components: [{ type: "body", parameters: [{ type: "text", text: "Sara" }] }],
    });
    const row = allOutbound(kit)[0];
    expect(row).toMatchObject({
      purpose: "utility",
      dispatchPhoneNumberId: "phone-1",
      dispatchWabaId: "waba-1",
      templateRevision: 2,
      correlationId: message.correlationId,
    });
    const events = kit.events.ofType("outreach.message.status_changed");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      from: "pending",
      to: "accepted",
      channel: "whatsapp",
    });
  });

  it("an idempotent replay returns the stored result with zero extra provider calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const first = okValue(await sendTemplate(kit));
    const total = kit.whatsapp.total;
    const second = okValue(await sendTemplate(kit));
    expect(second).toEqual(first);
    expect(kit.whatsapp.total).toBe(total);
    expect(allOutbound(kit)).toHaveLength(1);
  });

  it("refuses without ports, without a connection and after a disconnect, with zero calls", async () => {
    expect.hasAssertions();
    const off = createOutreachKit({ configured: false });
    expect(errorOf(await sendTemplate(off)).message).toBe("WHATSAPP_NOT_CONFIGURED");
    const kit = createOutreachKit();
    expect(errorOf(await sendTemplate(kit)).message).toBe("WHATSAPP_NOT_CONNECTED");
    const { conn } = await seedSendScenario(kit);
    await kit.mem.connections.save(
      { ...conn, status: "disconnected", sealedCredentials: "" },
      conn.version,
    );
    expect(errorOf(await sendTemplate(kit)).message).toBe("WHATSAPP_NOT_CONNECTED");
    expect(kit.whatsapp.total).toBe(0);
    expect(allOutbound(kit)).toHaveLength(0);
  });

  it("validates the recipient, names and key before anything else", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    for (const over of [
      { to: "12" },
      { templateName: " " },
      { language: "" },
      { idempotencyKey: "" },
    ]) {
      expect(errorOf(await sendTemplate(kit, over))).toBeInstanceOf(ValidationError);
    }
    expect(kit.whatsapp.total).toBe(0);
  });
});

describe("SendWhatsAppTemplate — template gates", () => {
  it("TEMPLATE_NOT_APPROVED for a missing or non-APPROVED template", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_NOT_APPROVED");
    await seedTemplate(kit, { status: "PENDING" });
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_NOT_APPROVED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("TEMPLATE_UNSUPPORTED for AUTHENTICATION and for an unsupported shape", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { name: "otp", category: "AUTHENTICATION" });
    await seedTemplate(kit, { name: "media", components: [{ type: "HEADER", format: "IMAGE" }] });
    expect(errorOf(await sendTemplate(kit, { templateName: "otp" })).message).toBe(
      "TEMPLATE_UNSUPPORTED",
    );
    expect(errorOf(await sendTemplate(kit, { templateName: "media" })).message).toBe(
      "TEMPLATE_UNSUPPORTED",
    );
    expect(kit.whatsapp.total).toBe(0);
  });

  it("TEMPLATE_STATUS_UNCERTAIN when the stored row is UNKNOWN or the fetch fails", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { name: "unk", status: "UNKNOWN" });
    expect(errorOf(await sendTemplate(kit, { templateName: "unk" })).message).toBe(
      "TEMPLATE_STATUS_UNCERTAIN",
    );
    const tpl = await seedTemplate(kit);
    kit.whatsapp.templates = [metaTemplate(tpl)];
    kit.whatsapp.set("getTemplate", () => {
      throw new Error("network");
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_STATUS_UNCERTAIN");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a Meta-side PAUSED while the stored row says APPROVED → TEMPLATE_STATUS_UNCERTAIN", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit);
    kit.whatsapp.templates = [metaTemplate(tpl, { status: "PAUSED" })];
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_STATUS_UNCERTAIN");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
    expect(allOutbound(kit)).toHaveLength(0);
    expect(kit.mem.store.templates.values()[0]?.status).toBe("PAUSED");
  });

  it("a Meta template with a different id/name/language is uncertain", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit);
    kit.whatsapp.templates = [metaTemplate(tpl, { name: "other" })];
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_STATUS_UNCERTAIN");
  });

  it("invalid template values are a ValidationError with no write and no freshness fetch", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const error = errorOf(await sendTemplate(kit, { values: { body: [] } }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields[0]).toEqual({
      field: "body",
      message: "send_values_mismatch",
    });
    expect(kit.whatsapp.total).toBe(0);
    expect(allOutbound(kit)).toHaveLength(0);
  });

  it("a template send to a contact with no inbound message for 3 days is NOT blocked by the window", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit, {
      contact: { lastInboundAt: new Date(kit.clock.now().getTime() - 3 * 24 * 3600 * 1000) },
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("accepted");
  });

  it("a language written en-US matches the stored en_US template", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tpl = await seedTemplate(kit, { name: "t_en", language: "en_US" });
    kit.whatsapp.templates = [metaTemplate(tpl)];
    await seedContact(kit, { transactional: "allowed" });
    expect(
      okValue(await sendTemplate(kit, { templateName: "t_en", language: "en-US" })).status,
    ).toBe("accepted");
  });
});

describe("SendWhatsAppTemplate — consent and suppression", () => {
  it("a fresh unknown contact is suppressed: no provider send, event pending→suppressed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tpl = await seedTemplate(kit);
    kit.whatsapp.templates = [metaTemplate(tpl)];
    const dto = okValue(await sendTemplate(kit));
    expect(dto.status).toBe("suppressed");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
    expect(kit.events.ofType("outreach.message.status_changed")[0]?.payload).toMatchObject({
      from: "pending",
      to: "suppressed",
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("suppressed");
    expect(kit.whatsapp.count("getTemplate")).toBe(1);
  });

  it("STOP before the reservation → suppressed with zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { contact } = await seedSendScenario(kit);
    await kit.mem.contacts.saveConsent(
      { ...contact, whatsappTransactional: "revoked" },
      contact.version,
    );
    expect(okValue(await sendTemplate(kit)).status).toBe("suppressed");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a missed UTILITY→MARKETING webhook with a revoked marketing contact is suppressed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit, {
      contact: { transactional: "allowed", marketing: "revoked" },
    });
    kit.whatsapp.templates = [metaTemplate(tpl, { category: "MARKETING" })];
    const dto = okValue(await sendTemplate(kit));
    expect(dto.status).toBe("suppressed");
    expect(allOutbound(kit)[0]?.purpose).toBe("marketing");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a marketing template needs a marketing grant", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit, {
      category: "MARKETING",
      contact: { transactional: "allowed", marketing: "granted" },
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("accepted");
  });
});

describe("SendWhatsAppTemplate — interleavings", () => {
  it("a WABA switch during the freshness fetch refuses with zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { conn } = await seedSendScenario(kit);
    kit.whatsapp.set("getTemplate", async () => {
      await kit.mem.connections.save(
        { ...conn, wabaId: "waba-2", phoneNumberId: "phone-2" },
        conn.version,
      );
      return metaTemplate((await kit.mem.templates.list(T1, "waba-1"))[0]!);
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("CONNECTION_CHANGED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
    expect(allOutbound(kit)).toHaveLength(0);
  });

  it("a disconnect during the freshness fetch is WHATSAPP_NOT_CONNECTED with zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { conn, tpl } = await seedSendScenario(kit);
    kit.whatsapp.set("getTemplate", async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
      return metaTemplate(tpl);
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("WHATSAPP_NOT_CONNECTED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a template event landing during the fetch makes the freshness uncertain", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit);
    kit.whatsapp.set("getTemplate", async () => {
      kit.clock.advance(1000);
      await kit.mem.templates.applyCategoryEvent(T1, "waba-1", tpl.metaTemplateId ?? "", {
        category: "MARKETING",
        eventAt: new Date(kit.clock.now().getTime() + 5000),
      });
      return metaTemplate(tpl);
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("TEMPLATE_STATUS_UNCERTAIN");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a category change applied after the reservation, before dispatch → AUTHORIZATION_EXPIRED, zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit);
    afterReservation(kit, async () => {
      await kit.mem.templates.applyCategoryEvent(T1, "waba-1", tpl.metaTemplateId ?? "", {
        category: "MARKETING",
        eventAt: new Date(kit.clock.now().getTime() + 60_000),
      });
    });
    const error = errorOf(await sendTemplate(kit));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("AUTHORIZATION_EXPIRED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "failed",
      errorCode: "AUTHORIZATION_EXPIRED",
      acceptedAt: null,
    });
    // a replay returns the stored failure and never dispatches
    expect(okValue(await sendTemplate(kit)).status).toBe("failed");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("consent revoked after the reservation, before dispatch → AUTHORIZATION_EXPIRED, zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { contact } = await seedSendScenario(kit);
    afterReservation(kit, async () => {
      const fresh = (await kit.mem.contacts.findById(T1, contact.id))!;
      await kit.mem.contacts.saveConsent(
        { ...fresh, whatsappTransactional: "revoked" },
        fresh.version,
      );
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("AUTHORIZATION_EXPIRED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("a disconnect after the reservation, before dispatch → AUTHORIZATION_EXPIRED, zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { conn } = await seedSendScenario(kit);
    afterReservation(kit, async () => {
      await kit.mem.connections.save(
        { ...conn, status: "disconnected", sealedCredentials: "" },
        conn.version,
      );
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("AUTHORIZATION_EXPIRED");
    expect(kit.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("an unreadable token at dispatch settles failed CREDENTIALS_UNAVAILABLE with zero sends", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    afterReservation(kit, () => {
      kit.vault.failOpen = true;
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("CREDENTIALS_UNAVAILABLE");
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "failed",
      errorCode: "CREDENTIALS_UNAVAILABLE",
    });
  });

  it("parallel same-key template sends make exactly one provider call", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const results = await Promise.all([sendTemplate(kit), sendTemplate(kit), sendTemplate(kit)]);
    // Concurrent freshness fetches of one template race on its revision: a loser is told to retry (and then replays).
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (!r.ok) expect(r.error.message).toBe("TEMPLATE_STATUS_UNCERTAIN");
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
    expect(allOutbound(kit)).toHaveLength(1);
    expect(okValue(await sendTemplate(kit)).status).toBe("accepted");
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });
});

describe("SendWhatsAppTemplate — outcomes and settlement", () => {
  it("a definite rejection settles failed with the code and no acceptedAt", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    kit.whatsapp.set("sendTemplate", () => ({
      kind: "rejected",
      code: "131026",
      message: "x",
      retryable: false,
    }));
    const dto = okValue(await sendTemplate(kit));
    expect(dto).toMatchObject({ status: "failed", errorCode: "131026", acceptedAt: null });
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("an unknown outcome is stored as unknown and never retried", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    kit.whatsapp.set("sendTemplate", () => ({ kind: "unknown", message: "timeout" }));
    expect(okValue(await sendTemplate(kit)).status).toBe("unknown");
    expect(okValue(await sendTemplate(kit)).status).toBe("unknown");
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("a port that throws is recorded as unknown, not retried", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    kit.whatsapp.set("sendTemplate", () => {
      throw new Error("socket hang up");
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("unknown");
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("a malformed 2xx from the real client becomes unknown (fake fetch, no network)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const { tpl } = await seedSendScenario(kit);
    const harness = createMetaFetchHarness([
      {
        status: 200,
        json: {
          id: tpl.metaTemplateId,
          name: tpl.name,
          language: tpl.language,
          category: "UTILITY",
          status: "APPROVED",
          components: tpl.components,
        },
      },
      { status: 200, json: { messaging_product: "whatsapp", messages: [] } },
    ]);
    kit.deps.whatsapp = new MetaGraphClient({
      appId: "app",
      appSecret: "secret-secret-secret",
      apiVersion: "v24.0",
      fetchImpl: harness.fetchImpl,
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("unknown");
    expect(harness.calls).toHaveLength(2);
  });

  it("a DB failure after an accepted send → SEND_OUTCOME_UNRECORDED, row stays pending, replay never re-dispatches", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const flag = { fail: false };
    failOutboundUpdateWhen(kit, flag);
    kit.whatsapp.set("sendTemplate", () => {
      flag.fail = true;
      return { kind: "accepted", providerMessageId: "wamid.lost" };
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("SEND_OUTCOME_UNRECORDED");
    flag.fail = false;
    const row = allOutbound(kit)[0];
    expect(row).toMatchObject({ status: "pending", providerMessageId: null });
    expect(row?.dispatchStartedAt).not.toBeNull();
    const replay = okValue(await sendTemplate(kit));
    expect(replay.status).toBe("pending");
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("settlement retries a lost CAS and still records the outcome", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    let injected = 0;
    const real = kit.mem.outbound;
    kit.deps.outbound = new Proxy(real, {
      get(target, prop) {
        if (prop === "update") {
          return (...args: Parameters<typeof real.update>) => {
            injected += 1;
            return injected === 1 ? Promise.reject(new Error("transient")) : target.update(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    expect(okValue(await sendTemplate(kit)).status).toBe("accepted");
    expect(kit.events.ofType("outreach.message.status_changed")).toHaveLength(1);
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
  });
});

describe("SendWhatsAppTemplate — callbacks racing the response", () => {
  async function inFlight(kit: OutreachKit) {
    const gate = deferred<{ kind: "accepted"; providerMessageId: string }>();
    kit.whatsapp.set("sendTemplate", () => gate.promise);
    const sending = sendTemplate(kit);
    await flush();
    const message = (
      kit.whatsapp.callsOf("sendTemplate")[0] as [string, string, { correlationId: string }]
    )[2];
    return { gate, sending, correlationId: message.correlationId };
  }
  const webhook = (kit: OutreachKit) => new ProcessWhatsAppWebhook(kit.deps);

  it("with correlation: the callback applies immediately to the pending row, and the late response keeps it", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const { gate, sending, correlationId } = await inFlight(kit);
    const ts = seconds(kit.clock.now());
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.early",
            status: "delivered",
            timestamp: ts,
            recipient: "201012345678",
            correlation: correlationId,
          }),
        ],
      }),
    });
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "delivered",
      providerMessageId: "wamid.early",
    });
    gate.resolve({ kind: "accepted", providerMessageId: "wamid.early" });
    const dto = okValue(await sending);
    expect(dto.status).toBe("delivered");
    expect(allOutbound(kit)[0]?.acceptedAt?.getTime()).toBe(ts * 1000);
  });

  it("an accepted response after an earlier delivered callback keeps delivered and the first acceptedAt", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const { gate, sending, correlationId } = await inFlight(kit);
    const ts = seconds(kit.clock.now()) - 30;
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.9",
            status: "delivered",
            timestamp: ts,
            recipient: "201012345678",
            correlation: correlationId,
          }),
        ],
      }),
    });
    kit.clock.advance(60_000);
    gate.resolve({ kind: "accepted", providerMessageId: "wamid.9" });
    const dto = okValue(await sending);
    expect(dto.status).toBe("delivered");
    expect(dto.acceptedAt).toBe(new Date(ts * 1000).toISOString());
  });

  it("without correlation: the callback is stored unmatched, then drained on settle (final status sent)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const { gate, sending } = await inFlight(kit);
    const result = okValue(
      await webhook(kit).execute({
        payload: messagesPayload("phone-1", {
          statuses: [
            statusItem({
              id: "wamid.7",
              status: "sent",
              timestamp: seconds(kit.clock.now()),
              recipient: "201012345678",
            }),
          ],
        }),
      }),
    );
    expect(result).toEqual({ processed: 1, skipped: 0 });
    expect(kit.mem.store.unmatched.values()).toHaveLength(1);
    expect(allOutbound(kit)[0]?.status).toBe("pending");
    gate.resolve({ kind: "accepted", providerMessageId: "wamid.7" });
    expect(okValue(await sending).status).toBe("sent");
    expect(kit.mem.store.unmatched.values()[0]?.resolvedAt).not.toBeNull();
    const to = kit.events.ofType("outreach.message.status_changed").map((e) => e.payload.to);
    expect(to).toEqual(["accepted", "sent"]);
  });

  it("response lost (unknown), then a correlated delivered → delivered with the provider id installed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    kit.whatsapp.set("sendTemplate", () => ({ kind: "unknown", message: "timeout" }));
    expect(okValue(await sendTemplate(kit)).status).toBe("unknown");
    const row = allOutbound(kit)[0]!;
    const ts = seconds(kit.clock.now()) + 0;
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.lost",
            status: "delivered",
            timestamp: ts,
            recipient: "201012345678",
            correlation: row.correlationId,
          }),
        ],
      }),
    });
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "delivered",
      providerMessageId: "wamid.lost",
    });
    expect(allOutbound(kit)[0]?.acceptedAt?.getTime()).toBe(ts * 1000);
  });

  it("a forged correlation for a different recipient stays unmatched and cannot be drained", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const { gate, sending, correlationId } = await inFlight(kit);
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.forged",
            status: "delivered",
            timestamp: seconds(kit.clock.now()),
            recipient: "201199999999",
            correlation: correlationId,
          }),
        ],
      }),
    });
    expect(allOutbound(kit)[0]?.status).toBe("pending");
    expect(kit.mem.store.unmatched.values()[0]?.correlationId).toBeNull();
    gate.resolve({ kind: "accepted", providerMessageId: "wamid.real" });
    expect(okValue(await sending).status).toBe("accepted");
  });

  it("the same tenant but a different dispatching phone → unmatched", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    okValue(await sendTemplate(kit));
    const row = allOutbound(kit)[0]!;
    kit.mem.store.outbound.set(row.id, { ...row, dispatchPhoneNumberId: "old-phone" }, undefined);
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: row.providerMessageId ?? "",
            status: "read",
            timestamp: seconds(kit.clock.now()),
            recipient: "201012345678",
            correlation: row.correlationId,
          }),
        ],
      }),
    });
    expect(allOutbound(kit)[0]?.status).toBe("accepted");
    expect(kit.mem.store.unmatched.values()).toHaveLength(1);
  });

  it("a correlated failed on a pending row installs the id but leaves acceptedAt null", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const { gate, sending, correlationId } = await inFlight(kit);
    await webhook(kit).execute({
      payload: messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.f",
            status: "failed",
            timestamp: seconds(kit.clock.now()),
            recipient: "201012345678",
            correlation: correlationId,
            errorCode: 131026,
          }),
        ],
      }),
    });
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "failed",
      providerMessageId: "wamid.f",
      acceptedAt: null,
      errorCode: "131026",
    });
    gate.resolve({ kind: "accepted", providerMessageId: "wamid.f" });
    expect(okValue(await sending).status).toBe("failed");
  });
});

describe("SendWhatsAppSessionMessage", () => {
  async function ready(
    lastInbound: Date | null,
    over: { transactional?: "allowed" | "revoked" | "unknown" } = {},
  ) {
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, {
      transactional: over.transactional ?? "allowed",
      lastInboundAt: lastInbound,
    });
    return kit;
  }
  const ago = (kit: OutreachKit, ms: number): Date => new Date(kit.clock.now().getTime() - ms);
  const H = 3600 * 1000;

  it("23h59 is open and the text goes out with the correlation id", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", lastInboundAt: ago(kit, 24 * H - 60_000) });
    expect(okValue(await sendSession(kit)).status).toBe("accepted");
    const [, , message] = kit.whatsapp.callsOf("sendText")[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(message).toMatchObject({ to: "+201012345678", text: "Your order is ready" });
    expect(allOutbound(kit)[0]).toMatchObject({ kind: "session_text", purpose: "transactional" });
  });

  it("24h01 and exactly 24h are closed (SESSION_WINDOW_CLOSED, zero calls); a missing contact too", async () => {
    expect.hasAssertions();
    for (const age of [24 * H + 60_000, 24 * H]) {
      const probe = createOutreachKit();
      await seedConnection(probe);
      await seedContact(probe, { transactional: "allowed", lastInboundAt: ago(probe, age) });
      expect(errorOf(await sendSession(probe)).message).toBe("SESSION_WINDOW_CLOSED");
      expect(probe.whatsapp.total).toBe(0);
    }
    const none = createOutreachKit();
    await seedConnection(none);
    expect(errorOf(await sendSession(none)).message).toBe("SESSION_WINDOW_CLOSED");
    const never = await ready(null);
    expect(errorOf(await sendSession(never)).message).toBe("SESSION_WINDOW_CLOSED");
  });

  it("a window that expires 1 ms after the reservation → AUTHORIZATION_EXPIRED, zero calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", lastInboundAt: ago(kit, 24 * H - 1) });
    afterReservation(kit, () => {
      kit.clock.advance(1);
    });
    expect(errorOf(await sendSession(kit)).message).toBe("AUTHORIZATION_EXPIRED");
    expect(kit.whatsapp.total).toBe(0);
    expect(allOutbound(kit)[0]).toMatchObject({
      status: "failed",
      errorCode: "AUTHORIZATION_EXPIRED",
    });
  });

  it("buttons use sendButtons with body = text; invalid input is a ValidationError", async () => {
    expect.hasAssertions();
    const kit = await ready(new Date(Date.now()));
    kit.clock.set(new Date());
    const kit2 = createOutreachKit();
    await seedConnection(kit2);
    await seedContact(kit2, { transactional: "allowed", lastInboundAt: ago(kit2, H) });
    const dto = okValue(
      await sendSession(kit2, {
        buttons: [{ id: "yes", title: "Yes" }],
        contextMessageId: "wamid.ctx",
      }),
    );
    expect(dto.status).toBe("accepted");
    const [, , message] = kit2.whatsapp.callsOf("sendButtons")[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(message).toMatchObject({
      body: "Your order is ready",
      buttons: [{ id: "yes", title: "Yes" }],
      contextMessageId: "wamid.ctx",
    });
    expect(kit2.whatsapp.count("sendText")).toBe(0);
    expect(allOutbound(kit2)[0]?.kind).toBe("session_interactive");
    const error = errorOf(await sendSession(kit2, { idempotencyKey: "s2", buttons: [] }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(errorOf(await sendSession(kit2, { idempotencyKey: "s3", text: "" }))).toBeInstanceOf(
      ValidationError,
    );
    expect(errorOf(await sendSession(kit2, { to: "1" }))).toBeInstanceOf(ValidationError);
  });

  it("a revoked contact is suppressed with zero calls; replay makes none", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "revoked", lastInboundAt: ago(kit, H) });
    expect(okValue(await sendSession(kit)).status).toBe("suppressed");
    expect(okValue(await sendSession(kit)).status).toBe("suppressed");
    expect(kit.whatsapp.total).toBe(0);
  });

  it("refuses when not configured or not connected", async () => {
    expect.hasAssertions();
    expect(errorOf(await sendSession(createOutreachKit({ configured: false }))).message).toBe(
      "WHATSAPP_NOT_CONFIGURED",
    );
    expect(errorOf(await sendSession(createOutreachKit())).message).toBe("WHATSAPP_NOT_CONNECTED");
  });

  it("parallel same-key session sends make one provider call", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", lastInboundAt: ago(kit, H) });
    const results = await Promise.all([sendSession(kit), sendSession(kit)]);
    results.forEach((r) => okValue(r));
    expect(kit.whatsapp.count("sendText")).toBe(1);
  });
});

describe("SendEmail", () => {
  it("sends with a stripped display name, reply-to, and a per-row provider idempotency key", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.profile.storeName = ' My "Shop" <Cairo>\r\n ';
    const dto = okValue(await sendEmail(kit));
    expect(dto).toMatchObject({ status: "accepted", providerMessageId: "email-1" });
    const call = kit.email.calls[0]!;
    expect(call.from).toBe("My Shop Cairo <no-reply@send.morbeh.com>");
    expect(call.replyTo).toBe("owner@shop.test");
    expect(call.to).toBe("buyer@shop.test");
    expect(call.idempotencyKey).toBe(`outreach/email/${allOutbound(kit)[0]?.id}`);
    expect(allOutbound(kit)[0]).toMatchObject({
      channel: "email",
      kind: "email",
      purpose: "transactional",
      providerIdempotencyKey: call.idempotencyKey,
    });
  });

  it("an empty display name falls back to Store and an invalid reply-to is omitted", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.profile.storeName = '"<>"';
    kit.profile.contactEmail = "not an email";
    okValue(await sendEmail(kit));
    expect(kit.email.calls[0]?.from).toBe("Store <no-reply@send.morbeh.com>");
    expect(kit.email.calls[0]?.replyTo).toBeUndefined();
  });

  it("marketing email is EMAIL_MARKETING_NOT_AVAILABLE with zero calls and no row", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    expect(
      errorOf(await sendEmail(kit, { purpose: "marketing", unsubscribeUrl: "https://x.test/u" }))
        .message,
    ).toBe("EMAIL_MARKETING_NOT_AVAILABLE");
    expect(kit.email.calls).toHaveLength(0);
    expect(allOutbound(kit)).toHaveLength(0);
  });

  it("EMAIL_NOT_CONFIGURED consumes no slot and writes nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit({ emailConfigured: false });
    expect(errorOf(await sendEmail(kit)).message).toBe("EMAIL_NOT_CONFIGURED");
    expect(kit.mem.store.emailCounters.values()).toHaveLength(0);
    expect(allOutbound(kit)).toHaveLength(0);
  });

  it("validates recipient, subject, bodies and key", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    for (const over of [
      { to: "nope" },
      { subject: " " },
      { subject: "a\nb" },
      { html: "" },
      { text: "" },
      { idempotencyKey: " " },
    ]) {
      expect(errorOf(await sendEmail(kit, over))).toBeInstanceOf(ValidationError);
    }
    expect(kit.email.calls).toHaveLength(0);
  });

  it("a replay returns the stored result with zero extra calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const a = okValue(await sendEmail(kit));
    const b = okValue(await sendEmail(kit));
    expect(b).toEqual(a);
    expect(kit.email.calls).toHaveLength(1);
  });

  it("two tenants using the same test-1 key get distinct provider keys", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    okValue(await sendEmail(kit, { idempotencyKey: "test-1" }));
    okValue(await sendEmail(kit, { tenantId: T2, idempotencyKey: "test-1" }));
    const keys = kit.email.calls.map((c) => c.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(allOutbound(kit)).toHaveLength(2);
  });

  it("cap boundary: the limit-th send is allowed, the next is EMAIL_CAP_REACHED with the insert rolled back", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit({ caps: { perHour: 2, perDay: 100 } });
    okValue(await sendEmail(kit, { idempotencyKey: "a" }));
    okValue(await sendEmail(kit, { idempotencyKey: "b" }));
    expect(errorOf(await sendEmail(kit, { idempotencyKey: "c" })).message).toBe(
      "EMAIL_CAP_REACHED",
    );
    expect(kit.email.calls).toHaveLength(2);
    expect(allOutbound(kit)).toHaveLength(2);
    expect(allOutbound(kit).some((o) => o.idempotencyKey === "c")).toBe(false);
  });

  it("a replay at the cap returns the stored row", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit({ caps: { perHour: 1, perDay: 100 } });
    const first = okValue(await sendEmail(kit, { idempotencyKey: "a" }));
    expect(okValue(await sendEmail(kit, { idempotencyKey: "a" }))).toEqual(first);
    expect(errorOf(await sendEmail(kit, { idempotencyKey: "b" })).message).toBe(
      "EMAIL_CAP_REACHED",
    );
  });

  it("parallel same-key email at limit-1 → one call and one slot", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit({ caps: { perHour: 2, perDay: 100 } });
    okValue(await sendEmail(kit, { idempotencyKey: "first" }));
    const results = await Promise.all([
      sendEmail(kit, { idempotencyKey: "same" }),
      sendEmail(kit, { idempotencyKey: "same" }),
    ]);
    results.forEach((r) => okValue(r));
    expect(kit.email.calls).toHaveLength(2);
    expect(errorOf(await sendEmail(kit, { idempotencyKey: "third" })).message).toBe(
      "EMAIL_CAP_REACHED",
    );
  });

  it("a definite rejection and an unknown outcome never set acceptedAt", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    kit.email.respond(() => ({
      kind: "rejected",
      code: "validation_error",
      message: "x",
      retryable: false,
    }));
    expect(okValue(await sendEmail(kit, { idempotencyKey: "r" }))).toMatchObject({
      status: "failed",
      acceptedAt: null,
      errorCode: null,
    });
    kit.email.respond(() => ({ kind: "unknown", message: "timeout" }));
    expect(okValue(await sendEmail(kit, { idempotencyKey: "u" }))).toMatchObject({
      status: "unknown",
      acceptedAt: null,
    });
    expect(kit.email.calls).toHaveLength(2);
  });

  it("a DB failure after an accepted email → SEND_OUTCOME_UNRECORDED and no second call on replay", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const flag = { fail: false };
    failOutboundUpdateWhen(kit, flag);
    kit.email.respond(() => {
      flag.fail = true;
      return { kind: "accepted", providerMessageId: "email-x" };
    });
    expect(errorOf(await sendEmail(kit)).message).toBe("SEND_OUTCOME_UNRECORDED");
    flag.fail = false;
    expect(okValue(await sendEmail(kit)).status).toBe("pending");
    expect(kit.email.calls).toHaveLength(1);
  });

  it("emits status_changed once per materialised change", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    okValue(await sendEmail(kit));
    expect(kit.events.ofType("outreach.message.status_changed").map((e) => e.payload.to)).toEqual([
      "accepted",
    ]);
  });
});

describe("parallel same-key sends on all three channels", () => {
  it("make one provider call each", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit, {
      contact: { lastInboundAt: new Date(kit.clock.now().getTime() - 3600_000) },
    });
    await Promise.all([
      sendTemplate(kit, { idempotencyKey: "t" }),
      sendTemplate(kit, { idempotencyKey: "t" }),
      sendSession(kit, { idempotencyKey: "s" }),
      sendSession(kit, { idempotencyKey: "s" }),
      sendEmail(kit, { idempotencyKey: "e" }),
      sendEmail(kit, { idempotencyKey: "e" }),
    ]);
    expect(kit.whatsapp.count("sendTemplate")).toBe(1);
    expect(kit.whatsapp.count("sendText")).toBe(1);
    expect(kit.email.calls).toHaveLength(1);
  });
});

describe("ReconcileUnresolvedOutbound", () => {
  const pendingRow = (kit: OutreachKit, over: Partial<OutboundRecord> = {}): OutboundRecord => ({
    id: "o-1",
    tenantId: T1,
    channel: "whatsapp",
    kind: "template",
    contactId: null,
    recipient: "+201012345678",
    templateName: "t",
    templateLanguage: "ar",
    templateRevision: 2,
    purpose: "utility",
    payload: {},
    idempotencyKey: "k",
    status: "pending",
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    contextRef: null,
    acceptedAt: null,
    correlationId: "c-1",
    dispatchStartedAt: new Date(kit.clock.now().getTime() - 400_000),
    providerIdempotencyKey: null,
    dispatchPhoneNumberId: "phone-1",
    dispatchWabaId: "waba-1",
    version: 1,
    ...over,
  });
  const run = (kit: OutreachKit, tenantId = T1) =>
    new ReconcileUnresolvedOutbound(kit.deps).execute({ tenantId });

  it("death right after the reservation → unknown after the threshold, never before, with zero provider calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await kit.mem.outbound.insert(
      pendingRow(kit, { dispatchStartedAt: new Date(kit.clock.now().getTime() - 299_000) }),
    );
    expect(okValue(await run(kit))).toBe(0);
    kit.clock.advance(2000);
    expect(okValue(await run(kit))).toBe(1);
    expect(allOutbound(kit)[0]?.status).toBe("unknown");
    expect(kit.events.ofType("outreach.message.status_changed")[0]?.payload).toMatchObject({
      from: "pending",
      to: "unknown",
    });
    expect(kit.whatsapp.total).toBe(0);
    expect(kit.email.calls).toHaveLength(0);
  });

  it("a settlement failure after an accepted send is recovered to unknown with zero calls", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedSendScenario(kit);
    const flag = { fail: false };
    failOutboundUpdateWhen(kit, flag);
    kit.whatsapp.set("sendTemplate", () => {
      flag.fail = true;
      return { kind: "accepted", providerMessageId: "wamid.z" };
    });
    expect(errorOf(await sendTemplate(kit)).message).toBe("SEND_OUTCOME_UNRECORDED");
    flag.fail = false;
    kit.clock.advance(301_000);
    const calls = kit.whatsapp.total;
    expect(okValue(await run(kit))).toBe(1);
    expect(allOutbound(kit)[0]?.status).toBe("unknown");
    expect(kit.whatsapp.total).toBe(calls);
  });

  it("a callback that advanced the row first leaves it unchanged", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await kit.mem.outbound.insert(pendingRow(kit));
    const row = allOutbound(kit)[0]!;
    kit.mem.store.outbound.set(row.id, { ...row, status: "delivered", version: 2 }, undefined);
    expect(okValue(await run(kit))).toBe(0);
    expect(allOutbound(kit)[0]?.status).toBe("delivered");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("running twice emits one event; another tenant's rows are untouched", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await kit.mem.outbound.insert(pendingRow(kit));
    await kit.mem.outbound.insert(
      pendingRow(kit, { id: "o-2", tenantId: T2, idempotencyKey: "k2", correlationId: "c-2" }),
    );
    expect(okValue(await run(kit))).toBe(1);
    expect(okValue(await run(kit))).toBe(0);
    expect(kit.events.ofType("outreach.message.status_changed")).toHaveLength(1);
    expect(allOutbound(kit).find((o) => o.tenantId === T2)?.status).toBe("pending");
    expect(okValue(await run(kit, T2))).toBe(1);
  });
});
