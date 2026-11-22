import { describe, expect, it } from "vitest";
import type { OutboundRecord } from "../domain/repositories";
import {
  createOutreachKit,
  seedConnection,
  seedContact,
  seedSendScenario,
  seedTemplate,
  T1,
  T2,
  type OutreachKit,
} from "../testing/outreach-kit";
import { okValue } from "../testing/result-helpers";
import {
  messagesPayload,
  seconds,
  statusItem,
  templateCategoryPayload,
  templateStatusPayload,
  textMessage,
} from "../testing/webhook-fixtures";
import { SendWhatsAppTemplate } from "./send.use-cases";
import { SyncTemplates } from "./template.use-cases";
import { ProcessWhatsAppWebhook } from "./webhook.use-case";

const run = async (kit: OutreachKit, payload: unknown) =>
  okValue(await new ProcessWhatsAppWebhook(kit.deps).execute({ payload }));
const now = (kit: OutreachKit): number => seconds(kit.clock.now());
const outbound = (kit: OutreachKit): OutboundRecord[] => kit.mem.store.outbound.values();

/** A sent template to +201012345678 via phone-1 (provider id wamid.1). */
async function sentMessage(kit: OutreachKit): Promise<OutboundRecord> {
  await seedSendScenario(kit);
  okValue(
    await new SendWhatsAppTemplate(kit.deps).execute({
      tenantId: T1,
      to: "01012345678",
      templateName: "cod_confirmation_ar",
      language: "ar",
      values: { body: ["Sara"] },
      idempotencyKey: "k1",
    }),
  );
  kit.events.calls.length = 0;
  return outbound(kit)[0] as OutboundRecord;
}

const status = (kit: OutreachKit, s: string, ts = now(kit), id = "wamid.1") =>
  messagesPayload("phone-1", {
    statuses: [statusItem({ id, status: s, timestamp: ts, recipient: "201012345678" })],
  });

describe("ProcessWhatsAppWebhook — statuses", () => {
  it("advances the outbound, emitting status_changed once per change", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const ts = now(kit);
    expect(await run(kit, status(kit, "sent", ts))).toEqual({ processed: 1, skipped: 0 });
    await run(kit, status(kit, "delivered", ts + 1));
    await run(kit, status(kit, "read", ts + 2));
    expect(outbound(kit)[0]?.status).toBe("read");
    const events = kit.events.ofType("outreach.message.status_changed");
    expect(events.map((e) => [e.payload.from, e.payload.to])).toEqual([
      ["accepted", "sent"],
      ["sent", "delivered"],
      ["delivered", "read"],
    ]);
    expect(events[0]?.payload.providerOccurredAt).toBe(new Date(ts * 1000).toISOString());
    expect(events[0]?.aggregateId).toBe(outbound(kit)[0]?.id);
    expect(events[0]?.tenantId).toBe(T1);
  });

  it("a duplicate status is ignored (one event, one marker) but still counts as processed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const payload = status(kit, "delivered");
    await run(kit, payload);
    expect(await run(kit, payload)).toEqual({ processed: 1, skipped: 0 });
    expect(kit.events.ofType("outreach.message.status_changed")).toHaveLength(1);
    expect(kit.mem.store.statusEvents.values()).toHaveLength(1);
  });

  it("out-of-order statuses keep the maximum; a late failed after delivered is ignored", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const ts = now(kit);
    await run(kit, status(kit, "read", ts + 5));
    await run(kit, status(kit, "delivered", ts + 3));
    await run(kit, status(kit, "sent", ts + 1));
    await run(kit, status(kit, "failed", ts + 9));
    expect(outbound(kit)[0]?.status).toBe("read");
    expect(kit.events.ofType("outreach.message.status_changed")).toHaveLength(1);
  });

  it("records the first error code of a failed status without provider text", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    await run(
      kit,
      messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.1",
            status: "failed",
            timestamp: now(kit),
            recipient: "201012345678",
            errorCode: 131026,
          }),
        ],
      }),
    );
    expect(outbound(kit)[0]).toMatchObject({ status: "failed", errorCode: "131026" });
    expect(JSON.stringify(kit.mem.store.statusEvents.values())).not.toContain("provider text");
  });

  it("an unknown wamid is stored unmatched and counted processed", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    expect(await run(kit, status(kit, "sent", now(kit), "wamid.unknown"))).toEqual({
      processed: 1,
      skipped: 0,
    });
    expect(kit.mem.store.unmatched.values()).toHaveLength(1);
    expect(outbound(kit)[0]?.status).toBe("accepted");
  });

  it("never touches another tenant's outbound with the same wamid", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    const row = await sentMessage(kit);
    await seedConnection(kit, { tenantId: T2, phoneNumberId: "phone-2", wabaId: "waba-2" });
    await run(
      kit,
      messagesPayload(
        "phone-2",
        {
          statuses: [
            statusItem({
              id: row.providerMessageId ?? "",
              status: "read",
              timestamp: now(kit),
              recipient: "201012345678",
            }),
          ],
        },
        "waba-2",
      ),
    );
    expect(outbound(kit)[0]?.status).toBe("accepted");
    expect(kit.mem.store.unmatched.values()[0]?.tenantId).toBe(T2);
  });

  it("skips malformed status items without discarding valid siblings", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const result = await run(
      kit,
      messagesPayload("phone-1", {
        statuses: [
          null,
          { id: "x" },
          statusItem({
            id: "wamid.1",
            status: "deleted",
            timestamp: now(kit),
            recipient: "201012345678",
          }),
          statusItem({
            id: "wamid.1",
            status: "sent",
            timestamp: "abc",
            recipient: "201012345678",
          }),
          statusItem({
            id: "wamid.1",
            status: "delivered",
            timestamp: now(kit),
            recipient: "201012345678",
          }),
        ],
      }),
    );
    expect(result).toEqual({ processed: 1, skipped: 4 });
    expect(outbound(kit)[0]?.status).toBe("delivered");
  });
});

describe("ProcessWhatsAppWebhook — routing and malformed input", () => {
  it("skips an unknown phone_number_id", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const payload = messagesPayload("nobody", {
      statuses: [statusItem({ id: "w", status: "sent", timestamp: now(kit), recipient: "1" })],
    });
    expect(await run(kit, payload)).toEqual({ processed: 0, skipped: 1 });
    expect(kit.mem.store.unmatched.values()).toHaveLength(0);
  });

  it("never throws on malformed shapes: they are skipped", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    for (const payload of [
      null,
      "x",
      5,
      {},
      { entry: "x" },
      {
        entry: [
          null,
          1,
          { changes: "x" },
          {
            changes: [
              null,
              { field: 1 },
              { field: "messages" },
              { field: "messages", value: {} },
              { field: "other", value: {} },
            ],
          },
        ],
      },
    ]) {
      const out = await run(kit, payload);
      expect(out.processed).toBe(0);
      expect(out.skipped).toBeGreaterThan(0);
    }
  });

  it("a malformed change does not discard a valid sibling in the same payload", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const good = status(kit, "delivered") as { entry: Array<{ changes: unknown[] }> };
    good.entry[0]?.changes.unshift({ field: "messages", value: { metadata: {} } });
    const out = await run(kit, good);
    expect(out).toEqual({ processed: 1, skipped: 1 });
    expect(outbound(kit)[0]?.status).toBe("delivered");
  });

  it("infrastructure errors propagate (the route answers 5xx so Meta retries)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    kit.deps.events = {
      emit: () => Promise.reject(new Error("outbox down")),
    };
    await expect(
      new ProcessWhatsAppWebhook(kit.deps).execute({ payload: status(kit, "delivered") }),
    ).rejects.toThrow("outbox down");
    expect(outbound(kit)[0]?.status).toBe("accepted");
    expect(kit.mem.store.statusEvents.values()).toHaveLength(0);
  });
});

describe("ProcessWhatsAppWebhook — inbound", () => {
  const inbound = (kit: OutreachKit, over: Record<string, unknown> = {}, name = "Sara") =>
    messagesPayload("phone-1", {
      contacts: [{ wa_id: "201012345678", profile: { name } }],
      messages: [
        textMessage({
          id: "wamid.in1",
          from: "201012345678",
          timestamp: now(kit),
          body: "hello",
          ...over,
        }),
      ],
    });

  it("creates the contact with the profile name, stores the inbound, sets lastInboundAt and emits once", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit) - 5;
    expect(await run(kit, inbound(kit, { timestamp: ts, contextId: "wamid.ctx" }))).toEqual({
      processed: 1,
      skipped: 0,
    });
    const contact = kit.mem.store.contacts.values()[0];
    expect(contact).toMatchObject({ phoneE164: "+201012345678", displayName: "Sara" });
    expect(contact?.lastInboundAt?.getTime()).toBe(ts * 1000);
    expect(kit.mem.store.inbound.values()[0]).toMatchObject({
      providerMessageId: "wamid.in1",
      type: "text",
      text: "hello",
      contextProviderMessageId: "wamid.ctx",
    });
    const events = kit.events.ofType("outreach.whatsapp.inbound_received");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      type: "text",
      buttonPayload: null,
      contextProviderMessageId: "wamid.ctx",
    });
    expect(contact?.whatsappTransactional).toBe("unknown");
  });

  it("maps a template button reply and an interactive button reply to their payloads; else other", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit);
    await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          {
            id: "m1",
            from: "201012345678",
            timestamp: String(ts),
            type: "button",
            button: { payload: "btn:0", text: "Confirm" },
            context: { id: "wamid.9" },
          },
          {
            id: "m2",
            from: "201012345678",
            timestamp: String(ts),
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } },
          },
          {
            id: "m3",
            from: "201012345678",
            timestamp: String(ts),
            type: "image",
            image: { id: "x" },
          },
        ],
      }),
    );
    const byId = Object.fromEntries(
      kit.mem.store.inbound.values().map((i) => [i.providerMessageId, i]),
    );
    expect(byId.m1).toMatchObject({
      type: "button",
      buttonPayload: "btn:0",
      contextProviderMessageId: "wamid.9",
    });
    expect(byId.m2).toMatchObject({ type: "interactive", buttonPayload: "yes", text: "Yes" });
    expect(byId.m3).toMatchObject({ type: "other", buttonPayload: null, text: null });
    expect(
      kit.events
        .ofType("outreach.whatsapp.inbound_received")
        .find((e) => e.payload.type === "button")?.payload.buttonPayload,
    ).toBe("btn:0");
  });

  it("STOP revokes both WhatsApp purposes with one consent event each", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", marketing: "granted" });
    await run(kit, inbound(kit, { body: " STOP " }));
    const c = kit.mem.store.contacts.values()[0];
    expect(c).toMatchObject({ whatsappMarketing: "revoked", whatsappTransactional: "revoked" });
    expect(kit.events.ofType("outreach.contact.consent_changed")).toHaveLength(2);
    expect((await kit.mem.contacts.listConsentEvents(T1, c?.id ?? ""))[0]?.source).toBe(
      "inbound_keyword",
    );
  });

  it("an Arabic stop keyword revokes; a sentence containing stop does not", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", marketing: "granted" });
    await run(kit, inbound(kit, { id: "w1", body: "please stop" }));
    expect(kit.mem.store.contacts.values()[0]?.whatsappMarketing).toBe("granted");
    await run(kit, inbound(kit, { id: "w2", body: "إلغاء" }));
    expect(kit.mem.store.contacts.values()[0]?.whatsappMarketing).toBe("revoked");
  });

  it("a duplicate inbound mutates nothing; a delayed duplicate two days later does not move the window", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit) - 10;
    await run(kit, inbound(kit, { timestamp: ts }));
    const before = kit.mem.store.contacts.values()[0];
    kit.events.calls.length = 0;
    kit.clock.advance(2 * 24 * 3600 * 1000);
    expect(await run(kit, inbound(kit, { timestamp: ts }))).toEqual({ processed: 1, skipped: 0 });
    expect(kit.mem.store.contacts.values()[0]).toEqual(before);
    expect(kit.events.calls).toHaveLength(0);
    expect(kit.mem.store.inbound.values()).toHaveLength(1);
  });

  it("an older message never lowers lastInboundAt", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit);
    await run(kit, inbound(kit, { id: "a", timestamp: ts - 1 }));
    await run(kit, inbound(kit, { id: "b", timestamp: ts - 100 }));
    expect(kit.mem.store.contacts.values()[0]?.lastInboundAt?.getTime()).toBe((ts - 1) * 1000);
  });

  it("future timestamps are skipped at now+1s and now+4min; exactly now is accepted", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    expect(await run(kit, inbound(kit, { id: "f1", timestamp: now(kit) + 1 }))).toEqual({
      processed: 0,
      skipped: 1,
    });
    expect(await run(kit, inbound(kit, { id: "f2", timestamp: now(kit) + 240 }))).toEqual({
      processed: 0,
      skipped: 1,
    });
    expect(kit.mem.store.inbound.values()).toHaveLength(0);
    expect(await run(kit, inbound(kit, { id: "f3", timestamp: now(kit) }))).toEqual({
      processed: 1,
      skipped: 0,
    });
  });

  it("skips an invalid sender, id or timestamp", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          null,
          { id: "a", from: "12", timestamp: String(now(kit)), type: "text", text: { body: "x" } },
          { from: "201012345678", timestamp: String(now(kit)) },
          { id: "c", from: "201012345678", timestamp: "nope" },
        ],
      }),
    );
    expect(out).toEqual({ processed: 0, skipped: 4 });
  });

  it("fault injection: an error after the inbound insert rolls everything back; the retry stores once and emits once", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const real = kit.mem.contacts;
    let failures = 1;
    kit.deps.contacts = new Proxy(real, {
      get(target, prop) {
        if (prop === "save") {
          return (...args: Parameters<typeof real.save>) => {
            // The first save creates the contact; fail the SECOND one (lastInboundAt), i.e. after the inbound insert.
            if (args[1] > 0 && failures > 0) {
              failures -= 1;
              return Promise.reject(new Error("db blip"));
            }
            return target.save(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    await expect(
      new ProcessWhatsAppWebhook(kit.deps).execute({ payload: inbound(kit) }),
    ).rejects.toThrow("db blip");
    expect(kit.mem.store.inbound.values()).toHaveLength(0);
    expect(kit.mem.store.contacts.values()).toHaveLength(0);
    expect(kit.events.calls).toHaveLength(0);
    expect(await run(kit, inbound(kit))).toEqual({ processed: 1, skipped: 0 });
    expect(kit.mem.store.inbound.values()).toHaveLength(1);
    expect(kit.events.ofType("outreach.whatsapp.inbound_received")).toHaveLength(1);
  });
});

describe("ProcessWhatsAppWebhook — strict item validation before the unit of work (I5)", () => {
  const phones = (kit: OutreachKit): Array<string | null> =>
    kit.mem.store.contacts.values().map((c) => c.phoneE164);

  it("invalid numeric dates and malformed text open no window and block no valid sibling", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit) - 30;
    const item = (id: string, from: string, timestamp: unknown) => ({
      id,
      from,
      timestamp,
      type: "text",
      text: { body: "hi" },
    });
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          item("bad-huge", "201011111111", 1e20),
          item("bad-max", "201011111112", Number.MAX_SAFE_INTEGER),
          item("bad-neg", "201011111113", -5),
          item("bad-frac", "201011111114", 1.5),
          item("bad-nan", "201011111115", Number.NaN),
          item("bad-inf", "201011111116", Number.POSITIVE_INFINITY),
          item("bad-digits", "201011111117", "99999999999999"),
          item("bad-bool", "201011111118", true),
          // malformed text shapes, each from a distinct sender
          { id: "m-notype", from: "201022222221", timestamp: String(ts), text: { body: "hi" } },
          { id: "m-badtype", from: "201022222222", timestamp: String(ts), type: 5 },
          { id: "m-notext", from: "201022222223", timestamp: String(ts), type: "text" },
          {
            id: "m-numbody",
            from: "201022222224",
            timestamp: String(ts),
            type: "text",
            text: { body: 42 },
          },
          {
            id: "m-emptybody",
            from: "201022222225",
            timestamp: String(ts),
            type: "text",
            text: { body: "" },
          },
          {
            id: "m-strtext",
            from: "201022222226",
            timestamp: String(ts),
            type: "text",
            text: "hi",
          },
          { id: "m-btn", from: "201022222227", timestamp: String(ts), type: "button", button: {} },
          {
            id: "m-int",
            from: "201022222228",
            timestamp: String(ts),
            type: "interactive",
            interactive: { button_reply: {} },
          },
          item("good", "201033333333", ts),
        ],
      }),
    );
    expect(out).toEqual({ processed: 1, skipped: 16 });
    expect(phones(kit)).toEqual(["+201033333333"]);
    expect(kit.mem.store.inbound.values().map((i) => i.providerMessageId)).toEqual(["good"]);
    expect(kit.events.ofType("outreach.whatsapp.inbound_received")).toHaveLength(1);
  });

  it("an empty interactive object and a declared button_reply without its reply are rejected, not kept as other (I5)", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit) - 30;
    const interactive = (id: string, from: string, body: unknown) => ({
      id,
      from,
      timestamp: String(ts),
      type: "interactive",
      interactive: body,
    });
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          interactive("i-empty", "201055555551", {}),
          interactive("i-declared", "201055555552", { type: "button_reply" }),
          interactive("i-string-reply", "201055555553", {
            type: "button_reply",
            button_reply: "yes",
          }),
          interactive("i-untyped-reply", "201055555554", { button_reply: [] }),
          interactive("i-bad-subtype", "201055555555", { type: 5 }),
          interactive("good-reply", "201055555556", {
            type: "button_reply",
            button_reply: { id: "yes", title: "Yes" },
          }),
          // a genuine subtype this service does not interpret is still kept as `other`
          interactive("list", "201055555557", {
            type: "list_reply",
            list_reply: { id: "r1", title: "Row" },
          }),
        ],
      }),
    );
    expect(out).toEqual({ processed: 2, skipped: 5 });
    const stored = kit.mem.store.inbound.values().map((i) => [i.providerMessageId, i.type]);
    expect(stored).toEqual([
      ["good-reply", "interactive"],
      ["list", "other"],
    ]);
    // no contact, window or event for any of the five rejected items
    expect(kit.mem.store.contacts.values()).toHaveLength(2);
    expect(kit.events.ofType("outreach.whatsapp.inbound_received")).toHaveLength(2);
  });

  it("an invalid STOP-shaped item changes no consent; legitimate unsupported types are still kept as other", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedContact(kit, { transactional: "allowed", marketing: "granted" });
    const ts = now(kit) - 30;
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          {
            id: "stop-bad-date",
            from: "201012345678",
            timestamp: 1e20,
            type: "text",
            text: { body: "STOP" },
          },
          {
            id: "img",
            from: "201012345678",
            timestamp: String(ts),
            type: "image",
            image: { id: "x" },
          },
          { id: "sticker", from: "201012345678", timestamp: String(ts), type: "sticker" },
          { id: "unsup", from: "201012345678", timestamp: String(ts), type: "unsupported" },
        ],
      }),
    );
    expect(out).toEqual({ processed: 3, skipped: 1 });
    expect(kit.mem.store.contacts.values()[0]).toMatchObject({
      whatsappMarketing: "granted",
      whatsappTransactional: "allowed",
    });
    expect(kit.mem.store.inbound.values().map((i) => i.type)).toEqual(["other", "other", "other"]);
  });

  it("an invalid numeric status date writes no marker and no unmatched fact; the valid sibling applies", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const bad = (timestamp: unknown, id = "wamid.1") => ({
      id,
      status: "delivered",
      timestamp,
      recipient_id: "201012345678",
    });
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        statuses: [
          bad(1e20),
          bad(Number.MAX_SAFE_INTEGER),
          bad(-1),
          bad(2.5),
          bad(Number.NaN, "wamid.nobody"),
          statusItem({
            id: "wamid.1",
            status: "sent",
            timestamp: now(kit),
            recipient: "201012345678",
          }),
        ],
      }),
    );
    expect(out).toEqual({ processed: 1, skipped: 5 });
    expect(kit.mem.store.unmatched.values()).toHaveLength(0);
    expect(kit.mem.store.statusEvents.values()).toHaveLength(1);
    expect(outbound(kit)[0]?.status).toBe("sent");
  });

  it("infrastructure failures on a valid item still escape after invalid siblings were skipped", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    kit.deps.events = { emit: () => Promise.reject(new Error("outbox down")) };
    const ts = now(kit) - 5;
    await expect(
      new ProcessWhatsAppWebhook(kit.deps).execute({
        payload: messagesPayload("phone-1", {
          messages: [
            { id: "bad", from: "201011111111", timestamp: 1e20, type: "text", text: { body: "x" } },
            textMessage({ id: "good", from: "201033333333", timestamp: ts, body: "hello" }),
          ],
        }),
      }),
    ).rejects.toThrow("outbox down");
    expect(kit.mem.store.inbound.values()).toHaveLength(0);
    expect(kit.mem.store.contacts.values()).toHaveLength(0);
  });
});

describe("ProcessWhatsAppWebhook — routing is revalidated inside each item's transaction (I10)", () => {
  /** Runs `fn` right before the n-th (1-based) unit of work opens, with no transaction held. */
  function beforeRun(kit: OutreachKit, n: number, fn: () => Promise<void>): void {
    const inner = kit.deps.unitOfWork;
    let calls = 0;
    kit.deps.unitOfWork = {
      run: async (tenantId, work) => {
        calls += 1;
        if (calls === n) await fn();
        return inner.run(tenantId, work);
      },
    };
  }
  /** phone-1 / waba-1 leaves T1 and is claimed by T2. */
  async function handOffToT2(kit: OutreachKit): Promise<void> {
    await kit.mem.directory.release("phone-1", T1);
    expect(await kit.mem.directory.claim("phone-1", "waba-1", T2)).toBe("claimed");
  }
  const contactsOf = (kit: OutreachKit, tenantId: string) =>
    kit.mem.store.contacts.values().filter((c) => c.tenantId === tenantId);

  it("a phone handed to another shop between two items: the old shop gets no STOP, the new shop gets nothing", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const seeded = await seedContact(kit, {
      phone: "+201044444444",
      transactional: "allowed",
      marketing: "granted",
    });
    const ts = now(kit) - 30;
    beforeRun(kit, 2, () => handOffToT2(kit));
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        messages: [
          textMessage({ id: "first", from: "201012345678", timestamp: ts, body: "hello" }),
          textMessage({ id: "second", from: "201044444444", timestamp: ts, body: "STOP" }),
        ],
      }),
    );
    expect(out).toEqual({ processed: 1, skipped: 1 });
    expect(kit.mem.store.inbound.values().map((i) => i.providerMessageId)).toEqual(["first"]);
    expect(contactsOf(kit, T2)).toHaveLength(0);
    expect(contactsOf(kit, T1).find((c) => c.id === seeded.id)).toMatchObject({
      whatsappMarketing: "granted",
      whatsappTransactional: "allowed",
      lastInboundAt: null,
    });
    expect(await kit.mem.contacts.listConsentEvents(T1, seeded.id)).toHaveLength(0);
    expect(kit.events.calls.filter((e) => e.tenantId === T2)).toHaveLength(0);
    expect(kit.events.ofType("outreach.whatsapp.inbound_received")).toHaveLength(1);
    expect(kit.events.ofType("outreach.contact.consent_changed")).toHaveLength(0);
  });

  it("an old-WABA inbound is not consumed once the phone belongs to another WABA, before or during the batch", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    const ts = now(kit) - 30;
    const payload = (waba: string) =>
      messagesPayload(
        "phone-1",
        {
          messages: [
            textMessage({ id: `m-${waba}`, from: "201012345678", timestamp: ts, body: "hi" }),
          ],
        },
        waba,
      );
    // the phone moves to waba-2 (same shop) AFTER the owner was resolved, before the item's transaction
    beforeRun(kit, 1, async () => {
      await kit.mem.directory.release("phone-1", T1);
      expect(await kit.mem.directory.claim("phone-1", "waba-2", T1)).toBe("claimed");
    });
    expect(await run(kit, payload("waba-1"))).toEqual({ processed: 0, skipped: 1 });
    expect(kit.mem.store.contacts.values()).toHaveLength(0);
    expect(kit.mem.store.inbound.values()).toHaveLength(0);
    expect(kit.events.calls).toHaveLength(0);
    // already moved when the batch arrives: the stale WABA is skipped, the current one is processed
    kit.deps.unitOfWork = kit.mem.unitOfWork;
    expect(await run(kit, payload("waba-1"))).toEqual({ processed: 0, skipped: 1 });
    expect(await run(kit, payload("waba-2"))).toEqual({ processed: 1, skipped: 0 });
    expect(kit.mem.store.inbound.values().map((i) => i.providerMessageId)).toEqual(["m-waba-2"]);
  });

  it("a status for a phone handed over mid-batch is not applied and stored for nobody", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await sentMessage(kit);
    const ts = now(kit);
    beforeRun(kit, 2, () => handOffToT2(kit));
    const out = await run(
      kit,
      messagesPayload("phone-1", {
        statuses: [
          statusItem({ id: "wamid.1", status: "sent", timestamp: ts, recipient: "201012345678" }),
          statusItem({
            id: "wamid.1",
            status: "read",
            timestamp: ts + 1,
            recipient: "201012345678",
          }),
        ],
      }),
    );
    expect(out).toEqual({ processed: 1, skipped: 1 });
    expect(outbound(kit)[0]?.status).toBe("sent");
    expect(kit.mem.store.unmatched.values()).toHaveLength(0);
    expect(kit.mem.store.statusEvents.values()).toHaveLength(1);
  });

  it("a template event is not applied once the WABA belongs to another shop", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit, { status: "PENDING" });
    kit.clock.advance(10_000);
    const time = now(kit);
    beforeRun(kit, 1, () => handOffToT2(kit));
    const out = await run(
      kit,
      templateStatusPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "APPROVED",
      }),
    );
    expect(out).toEqual({ processed: 0, skipped: 1 });
    expect(kit.mem.store.templates.values()[0]?.status).toBe("PENDING");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a category event is not applied once the WABA belongs to another shop", async () => {
    expect.hasAssertions();
    const kit = createOutreachKit();
    await seedConnection(kit);
    await seedTemplate(kit);
    kit.clock.advance(10_000);
    const time = now(kit);
    beforeRun(kit, 1, () => handOffToT2(kit));
    const out = await run(
      kit,
      templateCategoryPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        newCategory: "MARKETING",
      }),
    );
    expect(out).toEqual({ processed: 0, skipped: 1 });
    expect(kit.mem.store.templates.values()[0]?.category).toBe("UTILITY");
    expect(kit.events.calls).toHaveLength(0);
  });
});

describe("ProcessWhatsAppWebhook — template events", () => {
  async function setup() {
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tpl = await seedTemplate(kit, { status: "PENDING" });
    kit.clock.advance(10_000);
    return { kit, tpl, time: now(kit) };
  }
  const template = (kit: OutreachKit) => kit.mem.store.templates.values()[0];

  it("applies APPROVED by WABA + template id and emits template.status_changed with from/to", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    expect(
      await run(
        kit,
        templateStatusPayload({
          time,
          metaTemplateId: "meta-cod_confirmation_ar",
          event: "APPROVED",
        }),
      ),
    ).toEqual({ processed: 1, skipped: 0 });
    expect(template(kit)?.status).toBe("APPROVED");
    const e = kit.events.ofType("outreach.template.status_changed");
    expect(e).toHaveLength(1);
    expect(e[0]?.payload).toEqual({
      wabaId: "waba-1",
      metaTemplateId: "meta-cod_confirmation_ar",
      name: "cod_confirmation_ar",
      language: "ar",
      from: "PENDING",
      to: "APPROVED",
      category: "UTILITY",
    });
  });

  it("stores a sanitised rejection reason and maps REINSTATED/FLAGGED/LOCKED to UNKNOWN", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    await run(
      kit,
      templateStatusPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "REJECTED",
        reason: "INVALID_FORMAT",
      }),
    );
    expect(template(kit)).toMatchObject({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
    for (const [i, event] of ["REINSTATED", "FLAGGED", "LOCKED", "WHATEVER"].entries()) {
      await run(
        kit,
        templateStatusPayload({
          time: time + 100 + i * 20,
          metaTemplateId: "meta-cod_confirmation_ar",
          event,
        }),
      );
      expect(template(kit)?.status).toBe("UNKNOWN");
      await run(
        kit,
        templateStatusPayload({
          time: time + 110 + i * 20,
          metaTemplateId: "meta-cod_confirmation_ar",
          event: "APPROVED",
        }),
      );
    }
  });

  it("a stale event (older than the last reconcile) writes nothing and emits nothing", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    expect(
      await run(
        kit,
        templateStatusPayload({
          time: time - 3600,
          metaTemplateId: "meta-cod_confirmation_ar",
          event: "APPROVED",
        }),
      ),
    ).toEqual({ processed: 1, skipped: 0 });
    expect(template(kit)?.status).toBe("PENDING");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("an older APPROVED after a sync deletion is stale", async () => {
    expect.hasAssertions();
    const { kit } = await setup();
    kit.whatsapp.templates = [];
    okValue(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    expect(template(kit)?.status).toBe("DELETED");
    kit.events.calls.length = 0;
    await run(
      kit,
      templateStatusPayload({
        time: now(kit) - 5,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "APPROVED",
      }),
    );
    expect(template(kit)?.status).toBe("DELETED");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a status event and a category event with the same entry.time are both applied, in both orders", async () => {
    expect.hasAssertions();
    for (const order of ["status-first", "category-first"]) {
      const { kit, time } = await setup();
      const status = templateStatusPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "APPROVED",
      });
      const category = templateCategoryPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        newCategory: "MARKETING",
      });
      for (const p of order === "status-first" ? [status, category] : [category, status])
        await run(kit, p);
      expect(template(kit)).toMatchObject({ status: "APPROVED", category: "MARKETING" });
    }
  });

  it("an impending category notice (no new_category) changes nothing", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    expect(
      await run(
        kit,
        templateCategoryPayload({
          time,
          metaTemplateId: "meta-cod_confirmation_ar",
          correctCategory: "MARKETING",
        }),
      ),
    ).toEqual({ processed: 1, skipped: 0 });
    expect(template(kit)?.category).toBe("UTILITY");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("a category event arriving during a snapshot fetch is kept", async () => {
    expect.hasAssertions();
    const { kit, tpl } = await setup();
    kit.whatsapp.templates = [
      {
        id: tpl.metaTemplateId ?? "",
        name: tpl.name,
        language: tpl.language,
        category: "UTILITY",
        status: "APPROVED",
        components: tpl.components as unknown[],
        rejectedReason: null,
        qualityScore: null,
      },
    ];
    kit.whatsapp.set("listTemplates", async () => {
      kit.clock.advance(5000);
      await run(
        kit,
        templateCategoryPayload({
          time: now(kit),
          metaTemplateId: tpl.metaTemplateId ?? "",
          newCategory: "MARKETING",
        }),
      );
      return kit.whatsapp.templates;
    });
    okValue(await new SyncTemplates(kit.deps).execute({ tenantId: T1 }));
    expect(template(kit)?.category).toBe("MARKETING");
  });

  it("an unknown WABA, template id or malformed event is skipped or a no-op without emitting", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    expect(
      await run(
        kit,
        templateStatusPayload({ wabaId: "nope", time, metaTemplateId: "m", event: "APPROVED" }),
      ),
    ).toEqual({ processed: 0, skipped: 1 });
    expect(
      await run(
        kit,
        templateStatusPayload({ time, metaTemplateId: "not-ours", event: "APPROVED" }),
      ),
    ).toEqual({ processed: 1, skipped: 0 });
    const noTime = templateStatusPayload({ time, metaTemplateId: "m", event: "APPROVED" }) as {
      entry: Array<Record<string, unknown>>;
    };
    delete noTime.entry[0]?.time;
    expect(await run(kit, noTime)).toEqual({ processed: 0, skipped: 1 });
    expect(
      await run(kit, templateCategoryPayload({ time, metaTemplateId: "m", newCategory: "BOGUS" })),
    ).toEqual({ processed: 0, skipped: 1 });
    expect(kit.events.calls).toHaveLength(0);
  });
});

describe("ProcessWhatsAppWebhook — template events emit only on a material change (I11)", () => {
  async function setup() {
    const kit = createOutreachKit();
    await seedConnection(kit);
    const tpl = await seedTemplate(kit, { status: "PENDING" });
    kit.clock.advance(10_000);
    return { kit, tpl, time: now(kit) };
  }
  const template = (kit: OutreachKit) => kit.mem.store.templates.values()[0];
  const approved = (time: number) =>
    templateStatusPayload({
      time,
      metaTemplateId: "meta-cod_confirmation_ar",
      event: "APPROVED",
    });

  it("a repeated APPROVED at a later second advances the marker but emits nothing", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    await run(kit, approved(time));
    expect(kit.events.ofType("outreach.template.status_changed")).toHaveLength(1);
    const revision = template(kit)?.revision ?? 0;
    await run(kit, approved(time + 5));
    await run(kit, approved(time + 9));
    expect(kit.events.ofType("outreach.template.status_changed")).toHaveLength(1);
    expect(template(kit)).toMatchObject({
      status: "APPROVED",
      statusEventAt: new Date((time + 9) * 1000),
    });
    expect(template(kit)?.revision).toBe(revision + 2);
  });

  it("a category-only change emits exactly one event with the new category", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    await run(
      kit,
      templateCategoryPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        newCategory: "MARKETING",
      }),
    );
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      from: "PENDING",
      to: "PENDING",
      category: "MARKETING",
    });
    // the same category at a later second is a marker-only advance: nothing more
    await run(
      kit,
      templateCategoryPayload({
        time: time + 4,
        metaTemplateId: "meta-cod_confirmation_ar",
        newCategory: "MARKETING",
      }),
    );
    expect(kit.events.ofType("outreach.template.status_changed")).toHaveLength(1);
  });

  it("an equal-second contradiction emits one event, to UNKNOWN", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    await run(kit, approved(time));
    await run(
      kit,
      templateStatusPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "REJECTED",
      }),
    );
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events.map((e) => [e.payload.from, e.payload.to])).toEqual([
      ["PENDING", "APPROVED"],
      ["APPROVED", "UNKNOWN"],
    ]);
    expect(template(kit)?.status).toBe("UNKNOWN");
  });

  it("a status event on an UNKNOWN row only advances the marker and emits nothing", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    await run(kit, approved(time));
    await run(
      kit,
      templateStatusPayload({
        time,
        metaTemplateId: "meta-cod_confirmation_ar",
        event: "REJECTED",
      }),
    );
    kit.events.calls.length = 0;
    await run(kit, approved(time + 3));
    expect(template(kit)?.status).toBe("UNKNOWN");
    expect(kit.events.calls).toHaveLength(0);
  });

  it("the transition comes from the winning CAS: a writer that lands between the read and the CAS cannot skew from/to", async () => {
    expect.hasAssertions();
    const { kit, time } = await setup();
    // A concurrent writer moves the row PENDING → PAUSED right before this event's own read inside the repository.
    const real = kit.mem.templates;
    kit.deps.templates = new Proxy(real, {
      get(target, prop) {
        if (prop === "applyStatusEvent") {
          return (...args: Parameters<typeof real.applyStatusEvent>) => {
            const row = kit.mem.store.templates.values()[0];
            if (row !== undefined) {
              kit.mem.store.templates.set(
                row.id,
                { ...row, status: "PAUSED", revision: row.revision + 1 },
                undefined,
              );
            }
            return target.applyStatusEvent(...args);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    await run(kit, approved(time));
    const events = kit.events.ofType("outreach.template.status_changed");
    expect(events).toHaveLength(1);
    // the CAS replaced the PAUSED row (the writer's), so the event says PAUSED → APPROVED, never PENDING → APPROVED
    expect(events[0]?.payload).toMatchObject({ from: "PAUSED", to: "APPROVED" });
  });
});
