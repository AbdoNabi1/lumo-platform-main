import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createAdminHttpApi } from "@platform/admin";
import { RoleTableAccessControl } from "@platform/auth";
import type { Cache, IdempotencyKeyStore, RateLimiter } from "@platform/contracts";
import { type IntegrationEvent, JsonEventSerializer } from "@platform/domain-events";
import { createInMemoryOutboxEventSink } from "@platform/outreach/testing/outbox-store";
import { buildRuntimeCore } from "./composition";
import { loadRuntimeConfig } from "./config";

/**
 * Outreach Part 1, end to end: the real runtime composition (env readiness, Meta Graph client, envelope credential
 * vault) behind the real admin routes and the real platform-scoped public webhook, with only persistence in memory (a
 * transaction-aware in-memory outbox included) and HTTP to Meta going through a recording fake `fetch` (never the
 * network). Every webhook is signed with the app secret over the raw body, exactly as Meta does.
 */
const APP_SECRET = "s".repeat(16);
const baseEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
  META_APP_ID: "1234567890",
  META_APP_SECRET: APP_SECRET,
  META_WHATSAPP_CONFIG_ID: "cfg-1",
  META_WEBHOOK_VERIFY_TOKEN: "v".repeat(16),
  OUTREACH_CREDENTIALS_KEK_REF: "k".repeat(32),
} as NodeJS.ProcessEnv;

const SHOP = "t-1";
const WABA = "2002";
const PHONE = "1001";
const COD_META_ID = "meta-cod-1";
const PROMO_META_ID = "meta-promo-1";
// Assembled so no literal phone number sits in the source.
const BUYER = `+${["20", "10", "12345679"].join("")}`;
const STRANGER = `+${["20", "11", "23456789"].join("")}`;
const digits = (e164: string): string => e164.slice(1);
const admin = { authorization: "Bearer admin", "x-tenant-id": SHOP };

const codTemplate = {
  id: COD_META_ID,
  name: "cod_confirmation_ar",
  language: "ar",
  category: "UTILITY",
  status: "APPROVED",
  components: [
    { type: "BODY", text: "مرحبا {{1}}، هل تؤكد طلبك؟", example: { body_text: [["سارة"]] } },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "تأكيد" }] },
  ],
};
const promoTemplate = {
  id: PROMO_META_ID,
  name: "summer_offer_ar",
  language: "ar",
  category: "MARKETING",
  status: "APPROVED",
  components: [{ type: "BODY", text: "عرض الصيف لك يا {{1}}", example: { body_text: [["سارة"]] } }],
};

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

/** A recording router standing in for graph.facebook.com (never the network). */
function fakeMeta() {
  const calls: RecordedCall[] = [];
  let wamidCounter = 0;
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v24\.0/, "");
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, path, body: rawBody === undefined ? undefined : JSON.parse(rawBody) });
    if (url.origin !== "https://graph.facebook.com") return Promise.resolve(json({}, 500));
    if (path === "/oauth/access_token") return Promise.resolve(json({ access_token: "tok-e2e" }));
    if (path === `/${WABA}/phone_numbers`) return Promise.resolve(json({ data: [{ id: PHONE }] }));
    if (path === `/${WABA}/subscribed_apps` || path === `/${PHONE}/register`) {
      return Promise.resolve(json({ success: true }));
    }
    if (path === `/${WABA}/message_templates`) {
      return Promise.resolve(json({ data: [codTemplate, promoTemplate] }));
    }
    if (path === `/${PHONE}/messages`) {
      wamidCounter += 1;
      return Promise.resolve(json({ messages: [{ id: `wamid.E2E${wamidCounter}` }] }));
    }
    if (path === `/${PHONE}`) {
      return Promise.resolve(
        json({
          id: PHONE,
          display_phone_number: "+20 101 234 5678",
          verified_name: "Shop",
          quality_rating: "GREEN",
          whatsapp_business_manager_messaging_limit: "TIER_250",
        }),
      );
    }
    if (path === `/${COD_META_ID}`) return Promise.resolve(json(codTemplate));
    if (path === `/${PROMO_META_ID}`) return Promise.resolve(json(promoTemplate));
    return Promise.resolve(json({ error: { message: "unrouted", code: 100 } }, 404));
  };
  return {
    fetchImpl,
    calls,
    dispatches: (): RecordedCall[] =>
      calls.filter((c) => c.method === "POST" && c.path === `/${PHONE}/messages`),
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function boot() {
  const meta = fakeMeta();
  const core = buildRuntimeCore(loadRuntimeConfig(baseEnv), { outreachFetch: meta.fetchImpl });
  const serializer = new JsonEventSerializer();
  const { sink, outbox } = createInMemoryOutboxEventSink({ serializer, clock: core.clock });
  const cacheData = new Map<string, unknown>();
  const cache: Cache = {
    get: <T>(key: string) => Promise.resolve((cacheData.get(key) as T | undefined) ?? null),
    set: (key, value) => {
      cacheData.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      cacheData.delete(key);
      return Promise.resolve();
    },
    has: (key) => Promise.resolve(cacheData.has(key)),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key) => Promise.resolve({ key, token: "t", release: () => Promise.resolve(true) }),
  };
  const rateLimiter: RateLimiter = {
    consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const app = await createAdminHttpApi({
    serializer,
    idGenerator: core.idGenerator,
    clock: core.clock,
    accessControl: new RoleTableAccessControl(),
    authenticator: {
      verify: (token) =>
        Promise.resolve(
          token === "admin" ? { id: "admin-1", kind: "staff", roles: ["admin"] } : null,
        ),
    },
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    tenantId: SHOP,
    outreach: { ...core.outreach, events: sink },
  });
  apps.push(app);

  let keyCounter = 0;
  const post = (url: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: `/api/v1/outreach/whatsapp${url}`,
      headers: { ...admin, "idempotency-key": `e2e-${(keyCounter += 1)}` },
      payload: payload as object,
    });
  /** What Meta does: the raw body signed with the app secret, no auth, no tenant header. */
  const webhook = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return app.inject({
      method: "POST",
      url: "/api/v1/public/outreach/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`,
      },
      payload: raw,
    });
  };
  const published = (type?: string): Array<IntegrationEvent<Record<string, unknown>>> =>
    outbox
      .snapshot()
      .map((entry) =>
        serializer.deserialize<Record<string, unknown>>({
          type: entry.headers.type ?? "",
          eventVersion: 1,
          contentType: entry.contentType,
          data: entry.payload,
        }),
      )
      .filter((e) => type === undefined || e.type === type);
  const send = (to: string, templateName: string, attestConsent: boolean) =>
    post("/test-send", {
      to,
      templateName,
      language: "ar",
      values: { body: ["سارة"] },
      ...(attestConsent ? { attestConsent: true } : {}),
    });
  return { app, meta, outbox, post, webhook, published, send };
}

describe("Outreach Part 1 end to end (runtime composition, signed webhooks, fake Meta fetch)", () => {
  it("connect → sync → consented send → statuses → button reply → STOP → suppressed → disconnect", async () => {
    expect.hasAssertions();
    const { app, meta, post, webhook, published, send } = await boot();
    const now = Math.floor(Date.now() / 1000);
    const statusFor = (id: string, status: string, ts: number) => ({
      id,
      status,
      timestamp: String(ts),
      recipient_id: digits(BUYER),
    });
    const wrap = (value: Record<string, unknown>) => ({
      object: "whatsapp_business_account",
      entry: [
        {
          id: WABA,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "201012345678", phone_number_id: PHONE },
                ...value,
              },
            },
          ],
        },
      ],
    });

    // 1. Connect (the five Meta calls) → connected, token never echoed, `connected` event with the tenant.
    const connect = await post("/connect", {
      code: "auth-code",
      wabaId: WABA,
      phoneNumberId: PHONE,
    });
    expect(connect.statusCode).toBe(200);
    expect(connect.json<{ status: string; displayPhoneNumber: string }>()).toMatchObject({
      status: "connected",
      displayPhoneNumber: "+20 101 234 5678",
    });
    expect(connect.body).not.toContain("tok-e2e");
    expect(meta.calls).toHaveLength(5);
    const connected = published("outreach.whatsapp.connected");
    expect(connected).toHaveLength(1);
    expect(connected[0]).toMatchObject({
      tenantId: SHOP,
      aggregateType: "whatsapp_connection",
      payload: { phoneNumberId: PHONE, wabaId: WABA },
    });
    const version = connect.json<{ version: number }>().version;

    // 2. Sync templates → APPROVED cod_confirmation_ar (and an APPROVED marketing one).
    const sync = await post("/templates/sync", undefined);
    expect(sync.statusCode).toBe(200);
    const synced = sync.json<Array<{ name: string; status: string; category: string }>>();
    expect(synced.find((t) => t.name === "cod_confirmation_ar")).toMatchObject({
      status: "APPROVED",
      category: "UTILITY",
    });
    expect(synced.find((t) => t.name === "summer_offer_ar")).toMatchObject({
      status: "APPROVED",
      category: "MARKETING",
    });

    // 3. Utility consent granted by the admin attestation, then the template send is accepted.
    const first = await send(BUYER, "cod_confirmation_ar", true);
    expect(first.statusCode).toBe(200);
    const accepted = first.json<{
      outboundId: string;
      status: string;
      providerMessageId: string;
    }>();
    expect(accepted.status).toBe("accepted");
    expect(accepted.providerMessageId).toBe("wamid.E2E1");
    const dispatched = meta.dispatches();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.body).toMatchObject({
      messaging_product: "whatsapp",
      to: digits(BUYER),
      type: "template",
      template: { name: "cod_confirmation_ar", language: { code: "ar" } },
    });
    const wamid = accepted.providerMessageId;

    // A fresh unknown contact is suppressed: nothing is dispatched (the only provider call is the per-send
    // template freshness read, which precedes the reservation by design — R2-B04).
    const callsBefore = meta.calls.length;
    const stranger = await send(STRANGER, "cod_confirmation_ar", false);
    expect(stranger.statusCode).toBe(200);
    expect(stranger.json<{ status: string; providerMessageId: string | null }>()).toMatchObject({
      status: "suppressed",
      providerMessageId: null,
    });
    expect(meta.dispatches()).toHaveLength(1);
    expect(meta.calls.slice(callsBefore).map((c) => `${c.method} ${c.path}`)).toStrictEqual([
      `GET /${COD_META_ID}`,
    ]);

    // 4. sent → delivered → read, each a validly signed delivery: the DELTA is exactly three events.
    const statusEventsBefore = published("outreach.message.status_changed").length;
    const times = { sent: now - 30, delivered: now - 20, read: now - 10 } as const;
    for (const status of ["sent", "delivered", "read"] as const) {
      const res = await webhook(wrap({ statuses: [statusFor(wamid, status, times[status])] }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toStrictEqual({ received: true });
    }
    const statusEvents = published("outreach.message.status_changed").slice(statusEventsBefore);
    expect(statusEvents).toHaveLength(3);
    expect(statusEvents.map((e) => [e.payload.from, e.payload.to])).toStrictEqual([
      ["accepted", "sent"],
      ["sent", "delivered"],
      ["delivered", "read"],
    ]);
    for (const [index, status] of (["sent", "delivered", "read"] as const).entries()) {
      expect(statusEvents[index]).toMatchObject({
        tenantId: SHOP,
        aggregateId: accepted.outboundId,
        aggregateType: "outbound_message",
        payload: {
          outboundId: accepted.outboundId,
          channel: "whatsapp",
          providerMessageId: wamid,
          providerOccurredAt: new Date(times[status] * 1000).toISOString(),
        },
      });
    }
    // The same signed delivery again is a no-op.
    const replay = await webhook(wrap({ statuses: [statusFor(wamid, "read", times.read)] }));
    expect(replay.statusCode).toBe(200);
    expect(published("outreach.message.status_changed")).toHaveLength(statusEventsBefore + 3);

    // 5. The buyer taps the template's quick-reply button (context = the sent wamid).
    const inboundBefore = published("outreach.whatsapp.inbound_received").length;
    const tap = await webhook(
      wrap({
        messages: [
          {
            id: "wamid.IN1",
            from: digits(BUYER),
            timestamp: String(now - 5),
            type: "button",
            button: { text: "تأكيد", payload: "btn:0" },
            context: { id: wamid },
          },
        ],
      }),
    );
    expect(tap.statusCode).toBe(200);
    const inbound = published("outreach.whatsapp.inbound_received").slice(inboundBefore);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      tenantId: SHOP,
      aggregateType: "inbound_message",
      payload: {
        providerMessageId: "wamid.IN1",
        type: "button",
        buttonPayload: "btn:0",
        contextProviderMessageId: wamid,
      },
    });
    expect(inbound[0]?.aggregateId).toBe(inbound[0]?.payload.inboundId);
    // No message text travels in the event.
    expect(JSON.stringify(inbound[0])).not.toContain("تأكيد");

    // 6. The buyer writes "إلغاء" → consent revoked; later sends are suppressed with nothing dispatched.
    const consentBefore = published("outreach.contact.consent_changed").length;
    const stop = await webhook(
      wrap({
        messages: [
          {
            id: "wamid.IN2",
            from: digits(BUYER),
            timestamp: String(now - 2),
            type: "text",
            text: { body: "إلغاء" },
          },
        ],
      }),
    );
    expect(stop.statusCode).toBe(200);
    const revoked = published("outreach.contact.consent_changed").slice(consentBefore);
    expect(
      revoked.map((e) => [
        e.payload.channel,
        e.payload.purpose,
        e.payload.action,
        e.payload.source,
      ]),
    ).toStrictEqual([
      ["whatsapp", "marketing", "revoke", "inbound_keyword"],
      ["whatsapp", "transactional", "revoke", "inbound_keyword"],
    ]);
    expect(revoked.every((e) => e.tenantId === SHOP)).toBe(true);

    const dispatchesBefore = meta.dispatches().length;
    const marketing = await send(BUYER, "summer_offer_ar", false);
    expect(marketing.json<{ status: string }>().status).toBe("suppressed");
    // STOP also revoked the transactional grant, so even a UTILITY template (no re-attestation) is suppressed.
    const utility = await send(BUYER, "cod_confirmation_ar", false);
    expect(utility.json<{ status: string }>().status).toBe("suppressed");
    expect(meta.dispatches()).toHaveLength(dispatchesBefore);

    // 7. Disconnect → a send is WHATSAPP_NOT_CONNECTED (409) with no provider call at all; the webhook for the
    // released number is acknowledged and ignored.
    const disconnect = await post("/disconnect", { expectedVersion: version });
    expect(disconnect.statusCode).toBe(200);
    expect(disconnect.json<{ status: string }>().status).toBe("disconnected");
    const disconnected = published("outreach.whatsapp.disconnected");
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toMatchObject({
      tenantId: SHOP,
      payload: { wabaId: WABA, phoneNumberId: PHONE },
    });

    const callsAtDisconnect = meta.calls.length;
    const refused = await send(BUYER, "cod_confirmation_ar", true);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "CONFLICT", message: "WHATSAPP_NOT_CONNECTED" });
    expect(meta.calls).toHaveLength(callsAtDisconnect);

    const inboundAtDisconnect = published("outreach.whatsapp.inbound_received").length;
    const late = await webhook(
      wrap({
        messages: [
          {
            id: "wamid.IN3",
            from: digits(BUYER),
            timestamp: String(now - 1),
            type: "text",
            text: { body: "hello" },
          },
        ],
      }),
    );
    expect(late.statusCode).toBe(200);
    expect(published("outreach.whatsapp.inbound_received")).toHaveLength(inboundAtDisconnect);

    // A wrongly signed delivery never reaches the use case (counted as a delta again: the sends above emitted their own).
    const statusEventsAtForgery = published("outreach.message.status_changed").length;
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/public/outreach/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      payload: JSON.stringify(wrap({ statuses: [statusFor(wamid, "failed", now)] })),
    });
    expect(forged.statusCode).toBe(401);
    expect(published("outreach.message.status_changed")).toHaveLength(statusEventsAtForgery);
  });

  it("the transactional outbox is the platform's: every published type is a canonical .v1 outreach topic", async () => {
    expect.hasAssertions();
    const { post, outbox } = await boot();
    await post("/connect", { code: "auth-code", wabaId: WABA, phoneNumberId: PHONE });
    await post("/templates/sync", undefined);
    const topics = new Set(outbox.snapshot().map((e) => e.topic));
    expect([...topics].sort()).toStrictEqual([
      "outreach.template.status_changed.v1",
      "outreach.whatsapp.connected.v1",
    ]);
    expect(outbox.snapshot().every((e) => e.headers.tenantId === SHOP)).toBe(true);
  });
});
