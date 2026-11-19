import type { Database } from "@platform/db";
import { JsonEventSerializer } from "@platform/domain-events";
import { describe, expect, it } from "vitest";
import { wireOutreach, wireOutreachRecovery, type OutreachWiringDeps } from "./composition";
import { createMetaFetchHarness } from "./testing/meta-fetch-harness";
import { FakeClock, FakeEmailPort, FakeVault, FakeWhatsAppPort } from "./testing/fake-ports";
import { InMemoryOutreachEventRecorder } from "./testing/in-memory-outreach-event-recorder";
import { messagesPayload, seconds, statusItem } from "./testing/webhook-fixtures";

const T1 = "tenant-1";
const clock = new FakeClock(new Date("2026-11-19T10:00:00.000Z"));
let n = 0;
const base = (over: Partial<OutreachWiringDeps> = {}): OutreachWiringDeps => ({
  serializer: new JsonEventSerializer(),
  idGenerator: { generate: () => `id-${(n += 1)}` },
  clock,
  platformTenantId: "platform",
  emailCaps: { perHour: 10, perDay: 100 },
  storeProfile: { get: () => Promise.resolve({ storeName: "Shop", contactEmail: null }) },
  randomPin: () => "123456",
  ...over,
});
const body = (r: { body: unknown }): Record<string, unknown> => r.body as Record<string, unknown>;

describe("wireOutreach — not configured", () => {
  it("defaults no ports: available:false, and every provider path is a 409 feature rejection", async () => {
    expect.hasAssertions();
    const wired = wireOutreach(base());
    const connection = await wired.outreach.getConnection(T1);
    expect(connection).toMatchObject({
      status: 200,
      body: { available: false, status: "not_connected" },
    });
    const send = await wired.outreach.sendTemplate(T1, {
      to: "01012345678",
      templateName: "t",
      language: "ar",
      values: { body: [] },
      idempotencyKey: "k",
    });
    expect(send.status).toBe(409);
    expect(body(send)).toMatchObject({ code: "CONFLICT", message: "WHATSAPP_NOT_CONFIGURED" });
    const email = await wired.outreach.sendEmail(T1, {
      to: "a@b.test",
      subject: "s",
      html: "<p>x</p>",
      text: "x",
      purpose: "transactional",
      idempotencyKey: "k",
    });
    expect(body(email)).toMatchObject({ code: "CONFLICT", message: "EMAIL_NOT_CONFIGURED" });
    expect(await wired.outreach.getEmailSettings(T1)).toEqual({
      status: 200,
      body: { available: false, from: null, replyTo: null },
    });
    expect(wired.deliveredEventTypes).toEqual([]);
    expect(await wired.drainOutbox()).toBe(0);
  });
});

describe("wireOutreach — in-memory, end to end through the controller", () => {
  it("connect → sync → consent → send → signed-style status webhook → disconnect", async () => {
    expect.hasAssertions();
    const whatsapp = new FakeWhatsAppPort();
    whatsapp.templates = [
      {
        id: "meta-1",
        name: "cod_confirmation_ar",
        language: "ar",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi {{1}}" }],
        rejectedReason: null,
        qualityScore: null,
      },
    ];
    const events = new InMemoryOutreachEventRecorder();
    const email = new FakeEmailPort();
    const wired = wireOutreach(
      base({
        whatsapp,
        vault: new FakeVault(),
        email,
        emailFrom: "no-reply@send.morbeh.com",
        events,
      }),
    );
    const o = wired.outreach;

    const connected = await o.connect(T1, {
      code: "c",
      wabaId: "waba-1",
      phoneNumberId: "phone-1",
    });
    expect(connected).toMatchObject({
      status: 200,
      body: { status: "connected", available: true },
    });
    expect(JSON.stringify(connected.body)).not.toContain("token-c");

    expect((await o.syncTemplates(T1)).status).toBe(200);
    const listed = (await o.listTemplates(T1)).body as Array<{ name: string; status: string }>;
    expect(listed.map((t) => t.status)).toEqual(["APPROVED"]);

    const contact = (await o.upsertContact(T1, { phone: "01012345678" })).body as { id: string };
    await o.recordConsent(T1, {
      contactId: contact.id,
      channel: "whatsapp",
      purpose: "transactional",
      action: "grant",
      source: "admin",
    });
    const sent = await o.sendTemplate(T1, {
      to: "01012345678",
      templateName: "cod_confirmation_ar",
      language: "ar",
      values: { body: ["Sara"] },
      idempotencyKey: "k1",
    });
    expect(sent).toMatchObject({
      status: 200,
      body: { status: "accepted", providerMessageId: "wamid.1" },
    });

    const hook = await wired.webhook.process(
      messagesPayload("phone-1", {
        statuses: [
          statusItem({
            id: "wamid.1",
            status: "read",
            timestamp: seconds(clock.now()),
            recipient: "201012345678",
          }),
        ],
      }),
    );
    expect(hook.ok && hook.value).toEqual({ processed: 1, skipped: 0 });
    expect(events.ofType("outreach.message.status_changed").map((e) => e.payload.to)).toEqual([
      "accepted",
      "read",
    ]);

    const settings = await o.getEmailSettings(T1);
    expect(settings.body).toEqual({
      available: true,
      from: "Shop <no-reply@send.morbeh.com>",
      replyTo: null,
    });

    const version = (connected.body as { version: number }).version;
    expect(await o.disconnect(T1, { expectedVersion: version })).toMatchObject({
      status: 200,
      body: { status: "disconnected" },
    });
    const after = await o.sendTemplate(T1, {
      to: "01012345678",
      templateName: "cod_confirmation_ar",
      language: "ar",
      values: { body: ["x"] },
      idempotencyKey: "k2",
    });
    expect(body(after)).toMatchObject({ code: "CONFLICT", message: "WHATSAPP_NOT_CONNECTED" });
  });

  it("maps validation, not-found and version conflicts to 422 / 404 / 409 envelopes", async () => {
    expect.hasAssertions();
    const whatsapp = new FakeWhatsAppPort();
    const wired = wireOutreach(base({ whatsapp, vault: new FakeVault() }));
    const o = wired.outreach;
    await o.connect(T1, { code: "c", wabaId: "waba-1", phoneNumberId: "phone-1" });
    const invalid = await o.createTemplate(T1, {
      draft: {
        name: "Bad Name",
        language: "ar",
        category: "UTILITY",
        body: { text: "x", examples: [] },
      },
    });
    expect(invalid.status).toBe(422);
    expect(body(invalid)).toMatchObject({
      code: "VALIDATION",
      fields: [{ field: "name", message: "name_format" }],
    });
    const missing = await o.recordConsent(T1, {
      contactId: "nope",
      channel: "whatsapp",
      purpose: "marketing",
      action: "grant",
      source: "admin",
    });
    expect(missing.status).toBe(404);
    const stale = await o.disconnect(T1, { expectedVersion: 99 });
    expect(stale.status).toBe(409);
    expect(body(stale)).toMatchObject({ code: "CONCURRENCY" });
  });

  it("reconcileUnresolved is exposed per tenant", async () => {
    expect.hasAssertions();
    const wired = wireOutreach(base());
    expect(await wired.reconcileUnresolved(T1)).toBe(0);
  });

  it("works through the real Meta client over a fake fetch (no network)", async () => {
    expect.hasAssertions();
    const { MetaGraphClient } = await import("./infrastructure/meta-graph-client");
    const harness = createMetaFetchHarness([
      { status: 200, json: { access_token: "tok" } },
      { status: 200, json: { data: [{ id: "1001" }] } },
      { status: 200, json: { success: true } },
      { status: 200, json: { success: true } },
      {
        status: 200,
        json: {
          id: "1001",
          display_phone_number: "+20 101 234 5678",
          verified_name: "Shop",
          quality_rating: "GREEN",
          whatsapp_business_manager_messaging_limit: "TIER_250",
        },
      },
    ]);
    const wired = wireOutreach(
      base({
        whatsapp: new MetaGraphClient({
          appId: "app",
          appSecret: "secret-secret-secret",
          apiVersion: "v24.0",
          fetchImpl: harness.fetchImpl,
        }),
        vault: new FakeVault(),
      }),
    );
    const res = await wired.outreach.connect(T1, {
      code: "c",
      wabaId: "2002",
      phoneNumberId: "1001",
    });
    expect(res).toMatchObject({
      status: 200,
      body: { status: "connected", messagingLimitTier: "TIER_250" },
    });
    expect(harness.calls).toHaveLength(5);
    expect(harness.calls.every((c) => c.url.startsWith("https://graph.facebook.com/v24.0/"))).toBe(
      true,
    );
  });
});

/** A minimal Prisma double: only the delegates the exercised paths touch. */
function fakePrisma(
  calls: { name: string; args: unknown }[],
  rows: { outbound: unknown[] },
): Database {
  const track =
    <T>(name: string, result: T) =>
    (args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    };
  const tx = {
    $executeRaw: () => Promise.resolve(0),
    whatsAppConnection: { findFirst: track("connection.findFirst", null) },
    outboundMessage: {
      findMany: track(
        "outbound.findMany",
        rows.outbound.map((o) => ({ tenantId: T1, id: "o-1", version: 3, ...(o as object) })),
      ),
      updateMany: track("outbound.updateMany", { count: 1 }),
      findFirst: track("outbound.findFirst", {
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
        status: "unknown",
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        contextRef: null,
        acceptedAt: null,
        correlationId: "c",
        dispatchStartedAt: new Date(0),
        providerIdempotencyKey: null,
        dispatchPhoneNumberId: "phone-1",
        dispatchWabaId: "waba-1",
        version: 4,
      }),
    },
    outboxEntry: { createMany: track("outbox.createMany", { count: 1 }) },
  };
  return { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as Database;
}

describe("wireOutreach with Prisma", () => {
  it("uses the Prisma repositories (a connection read goes to Prisma)", async () => {
    expect.hasAssertions();
    const calls: { name: string; args: unknown }[] = [];
    const wired = wireOutreach(base({ prisma: fakePrisma(calls, { outbound: [] }) }));
    expect(await wired.outreach.getConnection(T1)).toMatchObject({
      body: { status: "not_connected" },
    });
    expect(calls.map((c) => c.name)).toEqual(["connection.findFirst"]);
    expect(calls[0]?.args).toEqual({ where: { tenantId: T1 } });
  });
});

describe("wireOutreachRecovery", () => {
  it("settles abandoned rows per tenant through Prisma + the outbox, with no provider ports", async () => {
    expect.hasAssertions();
    const calls: { name: string; args: unknown }[] = [];
    const recovery = wireOutreachRecovery({
      prisma: fakePrisma(calls, { outbound: [{}] }),
      clock,
      idGenerator: { generate: () => `rid-${(n += 1)}` },
      serializer: new JsonEventSerializer(),
      reconcileAfterMs: 300_000,
    });
    expect(await recovery.reconcileUnresolved(T1)).toBe(1);
    const list = calls.find((c) => c.name === "outbound.findMany");
    expect(list?.args).toMatchObject({
      where: {
        tenantId: T1,
        status: "pending",
        dispatchStartedAt: { lt: new Date(clock.now().getTime() - 300_000) },
      },
    });
    expect(calls.find((c) => c.name === "outbound.updateMany")?.args).toMatchObject({
      where: { tenantId: T1, id: "o-1", status: "pending", version: 3 },
    });
    const outbox = calls.find((c) => c.name === "outbox.createMany")?.args as {
      data: Array<{ topic: string; tenantId: string }>;
    };
    expect(outbox.data[0]).toMatchObject({
      topic: "outreach.message.status_changed.v1",
      tenantId: T1,
    });
  });

  it("returns 0 when nothing is unresolved and writes no outbox row", async () => {
    expect.hasAssertions();
    const calls: { name: string; args: unknown }[] = [];
    const recovery = wireOutreachRecovery({
      prisma: fakePrisma(calls, { outbound: [] }),
      clock,
      idGenerator: { generate: () => `rid-${(n += 1)}` },
      serializer: new JsonEventSerializer(),
      reconcileAfterMs: 300_000,
    });
    expect(await recovery.reconcileUnresolved(T1)).toBe(0);
    expect(calls.some((c) => c.name === "outbox.createMany")).toBe(false);
  });
});
