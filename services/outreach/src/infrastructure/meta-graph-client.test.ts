import { describe, expect, it } from "vitest";
import { createMetaFetchHarness, type FakeResponse } from "../testing/meta-fetch-harness";
import { MetaApiError, MetaGraphClient } from "./meta-graph-client";

const BASE = "https://graph.facebook.com/v24.0";
const TOKEN = "EAAB-token-SECRET-123";
const APP_SECRET = "app-secret-XYZ";
const FIELDS = "id,name,language,category,status,components,rejected_reason,quality_score";

function make(responses: FakeResponse[], extra: { timeoutMs?: number } = {}) {
  const h = createMetaFetchHarness(responses);
  const client = new MetaGraphClient({
    appId: "app-1",
    appSecret: APP_SECRET,
    apiVersion: "v24.0",
    fetchImpl: h.fetchImpl,
    ...extra,
  });
  return { h, client };
}

function authOk(call: { headers: Record<string, string> } | undefined): boolean {
  return call?.headers.authorization?.startsWith("Bearer ") === true;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

const malformedPaging: unknown[] = [
  { cursors: "invalid" },
  { cursors: [] },
  { cursors: null },
  { cursors: { after: 42 } },
  { cursors: { before: 42 } },
  { cursors: { after: null } },
];

const templateItem = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `100${n}`,
  name: `tpl_${n}`,
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi" }],
  ...extra,
});

describe("MetaGraphClient construction", () => {
  it("falls back to the global fetch when none is injected", () => {
    expect.hasAssertions();
    const client = new MetaGraphClient({ appId: "a", appSecret: "b", apiVersion: "v24.0" });
    expect(client).toBeInstanceOf(MetaGraphClient);
  });
});

describe("MetaGraphClient.exchangeCode", () => {
  it("GETs /oauth/access_token with the app credentials and returns the token", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      { status: 200, json: { access_token: TOKEN, token_type: "bearer" } },
    ]);
    expect(await client.exchangeCode("auth code/1")).toEqual({ accessToken: TOKEN });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.method).toBe("GET");
    expect(h.calls[0]?.url).toBe(
      `${BASE}/oauth/access_token?client_id=app-1&client_secret=${APP_SECRET}&code=auth+code%2F1`,
    );
    expect(h.calls[0]?.headers.authorization).toBeUndefined();
  });
  it("throws MetaApiError without leaking secrets when Meta rejects the code", async () => {
    expect.hasAssertions();
    const { client } = make([
      {
        status: 400,
        json: {
          error: { code: 100, message: `Invalid verification code ${APP_SECRET} / the-code` },
        },
      },
    ]);
    const error = await caught(client.exchangeCode("the-code"));
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).code).toBe("100");
    expect((error as MetaApiError).httpStatus).toBe(400);
    expect((error as MetaApiError).message).not.toContain(APP_SECRET);
    expect((error as MetaApiError).message).not.toContain("the-code");
  });
  it("throws INVALID_RESPONSE when access_token is missing", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: { token_type: "bearer" } },
      { status: 200, json: { access_token: "" } },
    ]);
    expect(await caught(client.exchangeCode("c"))).toMatchObject({
      code: "INVALID_RESPONSE",
      httpStatus: 200,
    });
    expect(await caught(client.exchangeCode("c"))).toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("MetaGraphClient WABA and phone registration", () => {
  it("subscribeApp POSTs /{waba}/subscribed_apps with the bearer token", async () => {
    expect.hasAssertions();
    const { h, client } = make([{ status: 200, json: { success: true } }]);
    await client.subscribeApp("1234567890", TOKEN);
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.url).toBe(`${BASE}/1234567890/subscribed_apps`);
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("registerPhone POSTs the pin with messaging_product", async () => {
    expect.hasAssertions();
    const { h, client } = make([{ status: 200, json: { success: true } }]);
    await client.registerPhone("555", "123456", TOKEN);
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.url).toBe(`${BASE}/555/register`);
    expect(h.calls[0]?.body).toEqual({ messaging_product: "whatsapp", pin: "123456" });
    expect(h.calls[0]?.headers["content-type"]).toBe("application/json");
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("redacts the pin and the token from MetaApiError messages", async () => {
    expect.hasAssertions();
    const { client } = make([
      {
        status: 400,
        json: { error: { code: 133005, message: `Two-step PIN mismatch 123456 token ${TOKEN}` } },
      },
    ]);
    const error = await caught(client.registerPhone("555", "123456", TOKEN));
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).code).toBe("133005");
    expect((error as MetaApiError).message).not.toContain("123456");
    expect((error as MetaApiError).message).not.toContain(TOKEN);
  });
});

describe("MetaGraphClient.getPhone", () => {
  const phoneFields =
    "id,display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit";
  const base = {
    id: "555",
    display_phone_number: "+20 100 000 0000",
    verified_name: "Shop",
    quality_rating: "GREEN",
  };

  it("requests the pinned fields and maps TIER_250", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      { status: 200, json: { ...base, whatsapp_business_manager_messaging_limit: "TIER_250" } },
    ]);
    expect(await client.getPhone("555", TOKEN)).toEqual({
      phoneNumberId: "555",
      displayPhoneNumber: "+20 100 000 0000",
      verifiedName: "Shop",
      qualityRating: "GREEN",
      messagingLimitTier: "TIER_250",
    });
    expect(h.calls[0]?.method).toBe("GET");
    expect(h.calls[0]?.url).toBe(`${BASE}/555?fields=${phoneFields}`);
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("keeps an unknown string as is", async () => {
    expect.hasAssertions();
    const { client } = make([
      {
        status: 200,
        json: { ...base, whatsapp_business_manager_messaging_limit: "TIER_BRAND_NEW" },
      },
    ]);
    expect((await client.getPhone("555", TOKEN)).messagingLimitTier).toBe("TIER_BRAND_NEW");
  });
  it("maps a missing, null or non-string limit to null and never reads messaging_limit_tier", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: { ...base, messaging_limit_tier: "TIER_1K" } },
      {
        status: 200,
        json: {
          ...base,
          whatsapp_business_manager_messaging_limit: null,
          messaging_limit_tier: "TIER_1K",
        },
      },
      {
        status: 200,
        json: { ...base, whatsapp_business_manager_messaging_limit: { tier: "TIER_250" } },
      },
      { status: 200, json: { ...base, whatsapp_business_manager_messaging_limit: 250 } },
    ]);
    for (let i = 0; i < 4; i++)
      expect((await client.getPhone("555", TOKEN)).messagingLimitTier).toBeNull();
  });
  it("maps absent optional fields to safe defaults", async () => {
    expect.hasAssertions();
    const { client } = make([{ status: 200, json: {} }]);
    expect(await client.getPhone("555", TOKEN)).toEqual({
      phoneNumberId: "555",
      displayPhoneNumber: "",
      verifiedName: "",
      qualityRating: null,
      messagingLimitTier: null,
    });
  });
  it("throws MetaApiError on a non-2xx and on a non-object body", async () => {
    expect.hasAssertions();
    const { client } = make([
      {
        status: 401,
        json: { error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } },
      },
      { status: 200, json: ["x"] },
    ]);
    const error = await caught(client.getPhone("555", TOKEN));
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).code).toBe("190");
    expect((error as MetaApiError).httpStatus).toBe(401);
    expect((error as MetaApiError).message).not.toContain(TOKEN);
    expect(await caught(client.getPhone("555", TOKEN))).toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("MetaGraphClient.listPhoneNumberIds", () => {
  it("requests fields=id and follows paging.next across two pages", async () => {
    expect.hasAssertions();
    const next = `${BASE}/99/phone_numbers?fields=id&after=CURSOR`;
    const { h, client } = make([
      { status: 200, json: { data: [{ id: "111" }, { id: "222" }], paging: { next } } },
      { status: 200, json: { data: [{ id: "333" }] } },
    ]);
    expect(await client.listPhoneNumberIds("99", TOKEN)).toEqual(["111", "222", "333"]);
    expect(h.calls.map((c) => c.url)).toEqual([`${BASE}/99/phone_numbers?fields=id`, next]);
    expect(h.calls.every((c) => c.method === "GET" && authOk(c))).toBe(true);
  });
  it("throws PHONE_LIST_INCOMPLETE for non-decimal ids, bad schema, a failed page or an off-host cursor", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      { status: 200, json: { data: [{ id: "12a" }] } },
      { status: 200, json: { data: [{ id: 5 }] } },
      { status: 200, json: { rows: [] } },
      { status: 500, json: {} },
      { status: 200, json: { data: [{ id: "1" }], paging: { next: "https://evil.example/x" } } },
    ]);
    for (let i = 0; i < 5; i++) {
      expect(await caught(client.listPhoneNumberIds("99", TOKEN))).toMatchObject({
        code: "PHONE_LIST_INCOMPLETE",
      });
    }
    expect(h.calls).toHaveLength(5);
  });
  it("rejects malformed paging.cursors as incomplete, on page one and after a valid first page", async () => {
    expect.hasAssertions();
    const next = `${BASE}/99/phone_numbers?fields=id&after=CURSOR`;
    for (const paging of malformedPaging) {
      const first = make([{ status: 200, json: { data: [], paging } }]);
      const firstError = await caught(first.client.listPhoneNumberIds("99", TOKEN));
      expect(firstError).toBeInstanceOf(MetaApiError);
      expect(firstError).toMatchObject({
        code: "PHONE_LIST_INCOMPLETE",
        httpStatus: 200,
        message: "Phone number list incomplete: invalid paging schema",
      });
      const second = make([
        { status: 200, json: { data: [{ id: "111" }], paging: { next } } },
        { status: 200, json: { data: [{ id: "222" }], paging } },
      ]);
      expect(await caught(second.client.listPhoneNumberIds("99", TOKEN))).toMatchObject({
        code: "PHONE_LIST_INCOMPLETE",
        httpStatus: 200,
        message: "Phone number list incomplete: invalid paging schema",
      });
      expect(second.h.calls).toHaveLength(2);
    }
  });
  it("still accepts absent cursors and a terminal page with valid cursors", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: { data: [{ id: "1" }] } },
      { status: 200, json: { data: [{ id: "2" }], paging: {} } },
      { status: 200, json: { data: [{ id: "3" }], paging: { cursors: {} } } },
      {
        status: 200,
        json: { data: [{ id: "4" }], paging: { cursors: { before: "B", after: "A" } } },
      },
    ]);
    expect(await client.listPhoneNumberIds("99", TOKEN)).toEqual(["1"]);
    expect(await client.listPhoneNumberIds("99", TOKEN)).toEqual(["2"]);
    expect(await client.listPhoneNumberIds("99", TOKEN)).toEqual(["3"]);
    expect(await client.listPhoneNumberIds("99", TOKEN)).toEqual(["4"]);
  });
});

describe("MetaGraphClient.listTemplates", () => {
  const firstUrl = `${BASE}/77/message_templates?fields=${FIELDS}&limit=100`;

  it("follows paging.next over two pages and maps records", async () => {
    expect.hasAssertions();
    const next = `${BASE}/77/message_templates?fields=${FIELDS}&limit=100&after=C1`;
    const { h, client } = make([
      {
        status: 200,
        json: {
          data: [
            templateItem(1, {
              quality_score: { score: "GREEN", date: 1 },
              rejected_reason: "NONE",
            }),
          ],
          paging: { cursors: { after: "C1" }, next },
        },
      },
      {
        status: 200,
        json: {
          data: [
            templateItem(2, {
              language: "ar",
              quality_score: { score: 5 },
              rejected_reason: "INCORRECT_CATEGORY",
            }),
            templateItem(3, { quality_score: "GREEN" }),
          ],
          paging: { cursors: { after: "C2" } },
        },
      },
    ]);
    const records = await client.listTemplates("77", TOKEN);
    expect(h.calls.map((c) => c.url)).toEqual([firstUrl, next]);
    expect(h.calls.every((c) => c.method === "GET" && authOk(c))).toBe(true);
    expect(records).toEqual([
      {
        id: "1001",
        name: "tpl_1",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi" }],
        rejectedReason: "NONE",
        qualityScore: "GREEN",
      },
      {
        id: "1002",
        name: "tpl_2",
        language: "ar",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi" }],
        rejectedReason: "INCORRECT_CATEGORY",
        qualityScore: null,
      },
      {
        id: "1003",
        name: "tpl_3",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hi" }],
        rejectedReason: null,
        qualityScore: null,
      },
    ]);
  });
  it("defaults missing components to [] and treats paging.next null as the last page", async () => {
    expect.hasAssertions();
    const { components: _c, ...noComponents } = templateItem(1);
    const { client } = make([
      { status: 200, json: { data: [noComponents], paging: { next: null } } },
    ]);
    expect((await client.listTemplates("77", TOKEN))[0]?.components).toEqual([]);
  });
  it("returns an empty list for an empty enumeration", async () => {
    expect.hasAssertions();
    const { client } = make([{ status: 200, json: { data: [] } }]);
    expect(await client.listTemplates("77", TOKEN)).toEqual([]);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE when page 2 fails and never returns partial data", async () => {
    expect.hasAssertions();
    const next = `${BASE}/77/message_templates?after=C1`;
    const { client } = make([
      { status: 200, json: { data: [templateItem(1)], paging: { next } } },
      { status: 500, json: { error: { code: 2, message: `boom ${TOKEN}` } } },
    ]);
    const error = await caught(client.listTemplates("77", TOKEN));
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ code: "TEMPLATE_SYNC_INCOMPLETE", httpStatus: 500 });
    expect((error as MetaApiError).message).not.toContain(TOKEN);
    expect((error as MetaApiError).message).not.toContain(next);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE when a page request throws a network error", async () => {
    expect.hasAssertions();
    const { client } = make([{ throw: new Error(`socket hang up ${TOKEN}`) }]);
    const error = await caught(client.listTemplates("77", TOKEN));
    expect(error).toMatchObject({ code: "TEMPLATE_SYNC_INCOMPLETE", httpStatus: 0 });
    expect((error as MetaApiError).message).not.toContain(TOKEN);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE when page 20 still has paging.next", async () => {
    expect.hasAssertions();
    const pages: FakeResponse[] = [];
    for (let i = 1; i <= 20; i++)
      pages.push({
        status: 200,
        json: {
          data: [templateItem(i)],
          paging: { next: `${BASE}/77/message_templates?after=C${i}` },
        },
      });
    pages.push({ status: 200, json: { data: [] } });
    const { h, client } = make(pages);
    expect(await caught(client.listTemplates("77", TOKEN))).toMatchObject({
      code: "TEMPLATE_SYNC_INCOMPLETE",
    });
    expect(h.calls).toHaveLength(20);
  });
  it("accepts an enumeration that ends exactly on page 20", async () => {
    expect.hasAssertions();
    const pages: FakeResponse[] = [];
    for (let i = 1; i <= 20; i++) {
      pages.push({
        status: 200,
        json: {
          data: [templateItem(i)],
          ...(i < 20 ? { paging: { next: `${BASE}/77/message_templates?after=C${i}` } } : {}),
        },
      });
    }
    const { h, client } = make(pages);
    expect(await client.listTemplates("77", TOKEN)).toHaveLength(20);
    expect(h.calls).toHaveLength(20);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE on a repeated paging URL", async () => {
    expect.hasAssertions();
    const next = `${BASE}/77/message_templates?after=C1`;
    const { h, client } = make([
      { status: 200, json: { data: [templateItem(1)], paging: { next } } },
      { status: 200, json: { data: [templateItem(2)], paging: { next } } },
      { status: 200, json: { data: [] } },
    ]);
    expect(await caught(client.listTemplates("77", TOKEN))).toMatchObject({
      code: "TEMPLATE_SYNC_INCOMPLETE",
    });
    expect(h.calls).toHaveLength(2);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE when next points back at the first request", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: { data: [templateItem(1)], paging: { next: firstUrl } } },
    ]);
    expect(await caught(client.listTemplates("77", TOKEN))).toMatchObject({
      code: "TEMPLATE_SYNC_INCOMPLETE",
    });
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE on a repeated cursor behind a different URL", async () => {
    expect.hasAssertions();
    const { client } = make([
      {
        status: 200,
        json: {
          data: [templateItem(1)],
          paging: { cursors: { after: "C1" }, next: `${BASE}/77/message_templates?after=C1` },
        },
      },
      {
        status: 200,
        json: {
          data: [templateItem(2)],
          paging: { cursors: { after: "C1" }, next: `${BASE}/77/message_templates?after=C1&x=1` },
        },
      },
    ]);
    expect(await caught(client.listTemplates("77", TOKEN))).toMatchObject({
      code: "TEMPLATE_SYNC_INCOMPLETE",
    });
  });
  it("never sends the token to another host and never echoes the paging URL", async () => {
    expect.hasAssertions();
    const offHost = [
      "https://evil.example/v24.0/77/message_templates?after=C1",
      "http://graph.facebook.com/v24.0/77/message_templates?after=C1",
      "https://graph.facebook.com.evil.example/v24.0/x",
      "https://graph.facebook.com@evil.example/x",
      "//evil.example/x",
      "not a url",
    ];
    for (const next of offHost) {
      const { h, client } = make([
        { status: 200, json: { data: [templateItem(1)], paging: { next } } },
        { status: 200, json: { data: [] } },
      ]);
      const error = await caught(client.listTemplates("77", TOKEN));
      expect(error).toMatchObject({ code: "TEMPLATE_SYNC_INCOMPLETE" });
      expect((error as MetaApiError).message).not.toContain("evil");
      expect(h.calls).toHaveLength(1);
    }
  });
  it("rejects malformed paging.cursors as incomplete instead of certifying an empty snapshot", async () => {
    expect.hasAssertions();
    const next = `${BASE}/77/message_templates?fields=${FIELDS}&limit=100&after=C1`;
    for (const paging of malformedPaging) {
      const first = make([{ status: 200, json: { data: [], paging } }]);
      const firstError = await caught(first.client.listTemplates("77", TOKEN));
      expect(firstError).toBeInstanceOf(MetaApiError);
      expect(firstError).toMatchObject({
        code: "TEMPLATE_SYNC_INCOMPLETE",
        httpStatus: 200,
        message: "Template sync incomplete: invalid paging schema",
      });
      const second = make([
        { status: 200, json: { data: [templateItem(1)], paging: { next } } },
        { status: 200, json: { data: [templateItem(2)], paging } },
      ]);
      expect(await caught(second.client.listTemplates("77", TOKEN))).toMatchObject({
        code: "TEMPLATE_SYNC_INCOMPLETE",
        httpStatus: 200,
        message: "Template sync incomplete: invalid paging schema",
      });
      expect(second.h.calls).toHaveLength(2);
    }
  });
  it("still accepts absent cursors and a terminal page with valid cursors", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: { data: [templateItem(1)] } },
      { status: 200, json: { data: [templateItem(2)], paging: { cursors: {} } } },
      {
        status: 200,
        json: { data: [templateItem(3)], paging: { cursors: { before: "B", after: "A" } } },
      },
    ]);
    expect((await client.listTemplates("77", TOKEN)).map((t) => t.id)).toEqual(["1001"]);
    expect((await client.listTemplates("77", TOKEN)).map((t) => t.id)).toEqual(["1002"]);
    expect((await client.listTemplates("77", TOKEN)).map((t) => t.id)).toEqual(["1003"]);
  });
  it("throws TEMPLATE_SYNC_INCOMPLETE on an invalid schema", async () => {
    expect.hasAssertions();
    const bad: unknown[] = [
      "nope",
      { data: "x" },
      { data: [null] },
      { data: [templateItem(1, { id: 5 })] },
      { data: [templateItem(1, { name: undefined })] },
      { data: [templateItem(1, { language: null })] },
      { data: [templateItem(1, { category: 1 })] },
      { data: [templateItem(1, { status: undefined })] },
      { data: [templateItem(1, { components: "x" })] },
      { data: [templateItem(1)], paging: { next: 42 } },
    ];
    const { h, client } = make(bad.map((json) => ({ status: 200, json })));
    for (let i = 0; i < bad.length; i++) {
      expect(await caught(client.listTemplates("77", TOKEN))).toMatchObject({
        code: "TEMPLATE_SYNC_INCOMPLETE",
      });
    }
    expect(h.calls).toHaveLength(bad.length);
  });
});

describe("MetaGraphClient.getTemplate", () => {
  it("GETs /{template_id} with the template fields and maps the record", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      {
        status: 200,
        json: templateItem(9, {
          quality_score: { score: "YELLOW", date: 2 },
          rejected_reason: "NONE",
        }),
      },
    ]);
    expect(await client.getTemplate("1009", TOKEN)).toEqual({
      id: "1009",
      name: "tpl_9",
      language: "en_US",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hi" }],
      rejectedReason: "NONE",
      qualityScore: "YELLOW",
    });
    expect(h.calls[0]?.method).toBe("GET");
    expect(h.calls[0]?.url).toBe(`${BASE}/1009?fields=${FIELDS}`);
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("throws MetaApiError on non-2xx and on an invalid record", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 404, json: { error: { code: 100, message: "Unsupported get request" } } },
      { status: 200, json: { id: "1" } },
    ]);
    expect(await caught(client.getTemplate("1", TOKEN))).toMatchObject({
      code: "100",
      httpStatus: 404,
    });
    expect(await caught(client.getTemplate("1", TOKEN))).toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("MetaGraphClient template writes", () => {
  it("createTemplate POSTs name, language, category and components", async () => {
    expect.hasAssertions();
    const t = {
      name: "order_update",
      language: "en_US",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hi {{1}}" }],
    };
    const { h, client } = make([
      { status: 200, json: { id: "2001", status: "PENDING", category: "UTILITY" } },
    ]);
    expect(await client.createTemplate("77", TOKEN, t)).toEqual({
      id: "2001",
      status: "PENDING",
      category: "UTILITY",
    });
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.url).toBe(`${BASE}/77/message_templates`);
    expect(h.calls[0]?.body).toEqual(t);
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("createTemplate throws on non-2xx and on an incomplete response", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 400, json: { error: { code: 2388023, message: "Template name already exists" } } },
      { status: 200, json: { id: "1" } },
    ]);
    const t = { name: "n", language: "en_US", category: "UTILITY", components: [] };
    expect(await caught(client.createTemplate("77", TOKEN, t))).toMatchObject({
      code: "2388023",
      httpStatus: 400,
    });
    expect(await caught(client.createTemplate("77", TOKEN, t))).toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("deleteTemplate DELETEs /{waba}/message_templates?name=", async () => {
    expect.hasAssertions();
    const { h, client } = make([{ status: 200, json: { success: true } }]);
    await client.deleteTemplate("77", TOKEN, "order update&x");
    expect(h.calls[0]?.method).toBe("DELETE");
    expect(h.calls[0]?.url).toBe(`${BASE}/77/message_templates?name=order%20update%26x`);
    expect(authOk(h.calls[0])).toBe(true);
  });
  it("deleteTemplate throws MetaApiError on non-2xx, even with a non-JSON error body", async () => {
    expect.hasAssertions();
    const h = createMetaFetchHarness([]);
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>bad gateway</html>", { status: 502 });
    const client = new MetaGraphClient({
      appId: "a",
      appSecret: APP_SECRET,
      apiVersion: "v24.0",
      fetchImpl,
    });
    const error = await caught(client.deleteTemplate("77", TOKEN, "n"));
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ code: "HTTP_502", httpStatus: 502 });
    expect(h.calls).toHaveLength(0);
  });
  it("non-send methods turn network failures into MetaApiError without the token", async () => {
    expect.hasAssertions();
    const { client } = make([
      { throw: new Error(`reset ${TOKEN}`) },
      { throw: Object.assign(new Error("aborted"), { name: "AbortError" }) },
    ]);
    const first = await caught(client.subscribeApp("77", TOKEN));
    expect(first).toMatchObject({ code: "NETWORK_ERROR", httpStatus: 0 });
    expect((first as MetaApiError).message).not.toContain(TOKEN);
    expect(await caught(client.subscribeApp("77", TOKEN))).toMatchObject({
      code: "TIMEOUT",
      httpStatus: 0,
    });
  });
  it("falls back to HTTP_<status> for a non-numeric error.code and ignores an unusable error.message", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 400, json: { error: { code: "OAuthException", message: 42 } } },
      { status: 400, json: { error: { code: {}, message: "x" } } },
    ]);
    expect(await caught(client.deleteTemplate("77", TOKEN, "n"))).toMatchObject({
      code: "HTTP_400",
      message: "Meta request failed (HTTP 400)",
    });
    expect(await caught(client.deleteTemplate("77", TOKEN, "n"))).toMatchObject({
      code: "HTTP_400",
    });
  });
  it("accepts only safe-integer provider codes and falls back to HTTP_<status> otherwise", async () => {
    expect.hasAssertions();
    const bad: unknown[] = [
      "OAuthException",
      "",
      " 100",
      "10 0",
      "1e3",
      "0x10",
      "-5",
      "+5",
      "12.5",
      "١٢٣",
      "99999999999999999999",
      1.5,
      -0.5,
      1e21,
      Number.MAX_SAFE_INTEGER + 2,
      true,
      null,
      [100],
      { code: 100 },
    ];
    const { client } = make(bad.map((code) => ({ status: 400, json: { error: { code } } })));
    for (let i = 0; i < bad.length; i++) {
      expect(await caught(client.deleteTemplate("77", TOKEN, "n"))).toMatchObject({
        code: "HTTP_400",
        httpStatus: 400,
      });
    }
    const good = make([
      { status: 400, json: { error: { code: "0131026" } } },
      { status: 400, json: { error: { code: 133005 } } },
    ]);
    expect(await caught(good.client.deleteTemplate("77", TOKEN, "n"))).toMatchObject({
      code: "131026",
    });
    expect(await caught(good.client.deleteTemplate("77", TOKEN, "n"))).toMatchObject({
      code: "133005",
    });
  });
  it("applies the same code sanitisation to rejected sends and keeps retryability by numeric code", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 400, json: { error: { code: "OAuthException", message: "m" } } },
      { status: 400, json: { error: { code: 1.5, message: "m" } } },
      { status: 400, json: { error: { code: "0130429", message: "m" } } },
    ]);
    const send = () => client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" });
    expect(await send()).toEqual({
      kind: "rejected",
      code: "HTTP_400",
      message: "m",
      retryable: false,
    });
    expect(await send()).toMatchObject({ code: "HTTP_400", retryable: false });
    expect(await send()).toMatchObject({ code: "130429", retryable: true });
  });
  it("never forwards a code that equals or contains a known secret, even when numeric", async () => {
    expect.hasAssertions();
    const send = make([
      { status: 400, json: { error: { code: 4455, message: "m" } } },
      { status: 400, json: { error: { code: "4455", message: "m" } } },
    ]);
    const secretToken = "4455";
    expect(
      await send.client.sendText("555", secretToken, { to: "2010", text: "x", correlationId: "c" }),
    ).toEqual({ kind: "rejected", code: "HTTP_400", message: "m", retryable: false });
    expect(
      await send.client.sendText("555", secretToken, { to: "2010", text: "x", correlationId: "c" }),
    ).toMatchObject({ code: "HTTP_400" });
    const pin = make([
      { status: 400, json: { error: { code: 1234567, message: "m" } } },
      { status: 400, json: { error: { code: 133005, message: "m" } } },
    ]);
    expect(await caught(pin.client.registerPhone("555", "234", TOKEN))).toMatchObject({
      code: "HTTP_400",
    });
    expect(await caught(pin.client.registerPhone("555", "234", TOKEN))).toMatchObject({
      code: "133005",
    });
  });
  it("discloses no token, app secret, authorization code or PIN anywhere in a send outcome", async () => {
    expect.hasAssertions();
    const send = make([
      { status: 400, json: { error: { code: "test-token", message: "x" } } },
      { status: 400, json: { error: { code: TOKEN, message: `bad ${TOKEN}` } } },
      { status: 400, json: { error: { code: `${TOKEN}`.toUpperCase(), message: TOKEN } } },
    ]);
    for (let i = 0; i < 3; i++) {
      const outcome = await send.client.sendText("555", TOKEN, {
        to: "2010",
        text: "x",
        correlationId: "c",
      });
      const serialized = JSON.stringify(outcome);
      expect(outcome).toMatchObject({ kind: "rejected", code: "HTTP_400" });
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain(APP_SECRET);
    }
    const probe = make([{ status: 400, json: { error: { code: "test-token", message: "x" } } }]);
    const probeOutcome = await probe.client.sendText("555", "test-token", {
      to: "2010",
      text: "x",
      correlationId: "c",
    });
    expect(probeOutcome).toEqual({
      kind: "rejected",
      code: "HTTP_400",
      message: "x",
      retryable: false,
    });
    expect(JSON.stringify(probeOutcome)).not.toContain("test-token");
  });
  it("discloses no PIN or token anywhere in a thrown registerPhone error", async () => {
    expect.hasAssertions();
    const pin = "pin-123456";
    const { client } = make([
      { status: 400, json: { error: { code: pin, message: `pin ${pin}` } } },
      { status: 400, json: { error: { code: TOKEN, message: `t ${TOKEN}` } } },
      { status: 400, json: { error: { code: `${pin}${TOKEN}`, message: `${pin} ${TOKEN}` } } },
    ]);
    for (let i = 0; i < 3; i++) {
      const error = await caught(client.registerPhone("555", pin, TOKEN));
      expect(error).toBeInstanceOf(MetaApiError);
      const e = error as MetaApiError;
      const serialized = JSON.stringify({
        name: e.name,
        code: e.code,
        message: e.message,
        httpStatus: e.httpStatus,
      });
      expect(e.code).toBe("HTTP_400");
      expect(serialized).not.toContain(pin);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain("123456");
    }
  });
  it("discloses no app secret or authorization code anywhere in a thrown exchangeCode error", async () => {
    expect.hasAssertions();
    const authCode = "secretCode";
    const { client } = make([
      {
        status: 400,
        json: {
          error: { code: `${APP_SECRET}-${authCode}`, message: `${APP_SECRET} ${authCode}` },
        },
      },
      { status: 400, json: { error: { code: APP_SECRET, message: "x" } } },
      { status: 400, json: { error: { code: authCode, message: "x" } } },
    ]);
    for (let i = 0; i < 3; i++) {
      const error = await caught(client.exchangeCode(authCode));
      expect(error).toBeInstanceOf(MetaApiError);
      const e = error as MetaApiError;
      const serialized = JSON.stringify({
        name: e.name,
        code: e.code,
        message: e.message,
        httpStatus: e.httpStatus,
      });
      expect(e.code).toBe("HTTP_400");
      expect(serialized).not.toContain(APP_SECRET);
      expect(serialized).not.toContain(authCode);
    }
  });
});

describe("MetaGraphClient sends", () => {
  const target = "+201001234567";

  it("sendTemplate posts the exact body with correlation data and to without '+'", async () => {
    expect.hasAssertions();
    const components = [{ type: "body", parameters: [{ type: "text", text: "Ahmed" }] }];
    const { h, client } = make([{ status: 200, json: { messages: [{ id: "wamid.1" }] } }]);
    const outcome = await client.sendTemplate("555", TOKEN, {
      to: target,
      name: "order_update",
      language: "en_US",
      components,
      correlationId: "corr-1",
    });
    expect(outcome).toEqual({ kind: "accepted", providerMessageId: "wamid.1" });
    expect(h.calls[0]?.method).toBe("POST");
    expect(h.calls[0]?.url).toBe(`${BASE}/555/messages`);
    expect(authOk(h.calls[0])).toBe(true);
    expect(h.calls[0]?.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201001234567",
      type: "template",
      template: { name: "order_update", language: { code: "en_US" }, components },
      biz_opaque_callback_data: "corr-1",
    });
  });
  it("sendText posts text, correlation data and the optional reply context", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      { status: 200, json: { messages: [{ id: "wamid.2" }] } },
      { status: 200, json: { messages: [{ id: "wamid.3" }] } },
    ]);
    await client.sendText("555", TOKEN, {
      to: "201001234567",
      text: "Hello",
      correlationId: "corr-2",
    });
    await client.sendText("555", TOKEN, {
      to: "201001234567",
      text: "Hello",
      contextMessageId: "wamid.in",
      correlationId: "corr-3",
    });
    expect(h.calls[0]?.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201001234567",
      type: "text",
      text: { body: "Hello" },
      biz_opaque_callback_data: "corr-2",
    });
    expect(h.calls[1]?.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201001234567",
      type: "text",
      text: { body: "Hello" },
      context: { message_id: "wamid.in" },
      biz_opaque_callback_data: "corr-3",
    });
  });
  it("sendButtons posts the interactive button body", async () => {
    expect.hasAssertions();
    const { h, client } = make([
      { status: 200, json: { messages: [{ id: "wamid.4" }] } },
      { status: 200, json: { messages: [{ id: "wamid.5" }] } },
    ]);
    const buttons = [
      { id: "yes", title: "Yes" },
      { id: "no", title: "12345678901234567890" },
    ];
    await client.sendButtons("555", TOKEN, {
      to: target,
      body: "Confirm?",
      buttons,
      correlationId: "corr-4",
    });
    await client.sendButtons("555", TOKEN, {
      to: target,
      body: "Confirm?",
      buttons: [{ id: "a", title: "A" }],
      contextMessageId: "wamid.in",
      correlationId: "corr-5",
    });
    expect(h.calls[0]?.url).toBe(`${BASE}/555/messages`);
    expect(h.calls[0]?.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201001234567",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Confirm?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "yes", title: "Yes" } },
            { type: "reply", reply: { id: "no", title: "12345678901234567890" } },
          ],
        },
      },
      biz_opaque_callback_data: "corr-4",
    });
    expect(h.calls[1]?.body).toMatchObject({
      context: { message_id: "wamid.in" },
      biz_opaque_callback_data: "corr-5",
    });
  });
  it("rejects invalid button sets with buttons_invalid and zero fetch calls", async () => {
    expect.hasAssertions();
    const { h, client } = make([]);
    const four = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` }));
    const send = (buttons: { id: string; title: string }[]) =>
      client.sendButtons("555", TOKEN, { to: target, body: "x", buttons, correlationId: "c" });
    await expect(send(four)).rejects.toThrow("buttons_invalid");
    await expect(send([{ id: "a", title: "123456789012345678901" }])).rejects.toThrow(
      "buttons_invalid",
    );
    await expect(send([])).rejects.toThrow("buttons_invalid");
    expect(h.calls).toHaveLength(0);
  });
  it("maps 2xx without messages[0].id to unknown", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 200, json: {} },
      { status: 200, json: { messages: [] } },
      { status: 200, json: { messages: [{ id: "" }] } },
      { status: 200, json: { messages: [{}] } },
      { status: 200, json: { messages: "x" } },
      { status: 200, json: null },
    ]);
    for (let i = 0; i < 6; i++) {
      expect(
        (await client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" })).kind,
      ).toBe("unknown");
    }
  });
  it("maps a 4xx with error.code to rejected and flags retryable codes", async () => {
    expect.hasAssertions();
    const err = (code: number | string, message = "nope") => ({
      status: 400,
      json: { error: { code, message } },
    });
    const { client } = make([
      err(131026, "Message undeliverable"),
      err(130429),
      err(131056),
      err(80007),
      err("131026"),
    ]);
    const send = () => client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" });
    expect(await send()).toEqual({
      kind: "rejected",
      code: "131026",
      message: "Message undeliverable",
      retryable: false,
    });
    expect(await send()).toMatchObject({ kind: "rejected", code: "130429", retryable: true });
    expect(await send()).toMatchObject({ kind: "rejected", code: "131056", retryable: true });
    expect(await send()).toMatchObject({ kind: "rejected", code: "80007", retryable: true });
    expect(await send()).toMatchObject({ kind: "rejected", code: "131026", retryable: false });
  });
  it("treats HTTP 429 as retryable and 4xx without error.code as rejected", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 429, json: { error: { code: 4, message: "rate" } } },
      { status: 429, json: {} },
      { status: 403, json: { error: { message: "denied" } } },
    ]);
    const send = () => client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" });
    expect(await send()).toMatchObject({ kind: "rejected", code: "4", retryable: true });
    expect(await send()).toMatchObject({ kind: "rejected", code: "HTTP_429", retryable: true });
    expect(await send()).toMatchObject({
      kind: "rejected",
      code: "HTTP_403",
      message: "denied",
      retryable: false,
    });
  });
  it("maps 5xx, network errors, aborts and unexpected statuses to unknown", async () => {
    expect.hasAssertions();
    const abort = new DOMException("The operation was aborted", "AbortError");
    const { client } = make([
      { status: 500, json: {} },
      { status: 503, json: { error: { code: 2 } } },
      { throw: new Error("ECONNRESET") },
      { throw: abort },
      { status: 302, json: {} },
    ]);
    const send = () =>
      client.sendTemplate("555", TOKEN, {
        to: "2010",
        name: "n",
        language: "en",
        components: [],
        correlationId: "c",
      });
    expect((await send()).kind).toBe("unknown");
    expect((await send()).kind).toBe("unknown");
    expect((await send()).kind).toBe("unknown");
    const aborted = await send();
    expect(aborted).toEqual({ kind: "unknown", message: "Meta request timed out" });
    expect((await send()).kind).toBe("unknown");
  });
  it("never leaks the token in any outcome message", async () => {
    expect.hasAssertions();
    const { client } = make([
      { status: 401, json: { error: { code: 190, message: `Bad token ${TOKEN} here ${TOKEN}` } } },
      { throw: new Error(`fetch failed for Bearer ${TOKEN}`) },
      { status: 500, json: { error: { code: 1, message: TOKEN } } },
    ]);
    const outcomes = [];
    for (let i = 0; i < 3; i++)
      outcomes.push(
        await client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" }),
      );
    expect(outcomes.map((o) => o.kind)).toEqual(["rejected", "unknown", "unknown"]);
    expect(JSON.stringify(outcomes)).not.toContain(TOKEN);
    expect(JSON.stringify(outcomes)).toContain("[redacted]");
  });
  it("aborts a hung request after the injected timeoutMs and reports unknown", async () => {
    expect.hasAssertions();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        seenSignal = init?.signal ?? undefined;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const client = new MetaGraphClient({
      appId: "a",
      appSecret: APP_SECRET,
      apiVersion: "v24.0",
      fetchImpl,
      timeoutMs: 20,
    });
    const outcome = await client.sendText("555", TOKEN, {
      to: "2010",
      text: "x",
      correlationId: "c",
    });
    expect(outcome).toEqual({ kind: "unknown", message: "Meta request timed out" });
    expect(seenSignal?.aborted).toBe(true);
  });
  it("does not abort a fast request (timer is cleared)", async () => {
    expect.hasAssertions();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.fast" }] }), { status: 200 });
    };
    const client = new MetaGraphClient({
      appId: "a",
      appSecret: APP_SECRET,
      apiVersion: "v24.0",
      fetchImpl,
      timeoutMs: 50,
    });
    expect(
      await client.sendText("555", TOKEN, { to: "2010", text: "x", correlationId: "c" }),
    ).toEqual({ kind: "accepted", providerMessageId: "wamid.fast" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(seenSignal?.aborted).toBe(false);
  });
  it("maps a non-send abort to MetaApiError TIMEOUT using the injected timeout", async () => {
    expect.hasAssertions();
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const client = new MetaGraphClient({
      appId: "a",
      appSecret: APP_SECRET,
      apiVersion: "v24.0",
      fetchImpl,
      timeoutMs: 20,
    });
    expect(await caught(client.getPhone("555", TOKEN))).toMatchObject({
      code: "TIMEOUT",
      httpStatus: 0,
    });
  });
});

describe("MetaApiError", () => {
  it("carries code, message and httpStatus", () => {
    expect.hasAssertions();
    const error = new MetaApiError("100", "bad", 400);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MetaApiError");
    expect([error.code, error.message, error.httpStatus]).toEqual(["100", "bad", 400]);
  });
});
