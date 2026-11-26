import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_PENDING,
  SETTINGS,
  TEMPLATES,
  detail,
} from "@/components/settings/notifications/test-fixtures";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: jwtVerifyMock }));

const api = await import("./notification-settings");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function request(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url: call[0],
    method: call[1].method,
    body: typeof call[1].body === "string" ? (JSON.parse(call[1].body) as unknown) : undefined,
    headers: call[1].headers as Record<string, string>,
  };
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("reads", () => {
  it("reads the settings document with its version and delivery flag", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, SETTINGS));

    expect(await api.fetchNotificationSettings()).toEqual({ outcome: "ok", settings: SETTINGS });
    expect(request(fetchMock).url).toBe("http://runtime.test/api/v1/notifications/settings");
  });

  it("refuses a settings body without the delivery flag as an error, never as settings", async () => {
    expect.hasAssertions();
    const { deliveryConfigured: _omitted, ...broken } = SETTINGS;
    stubFetch(jsonResponse(200, broken));

    expect((await api.fetchNotificationSettings()).outcome).toBe("error");
  });

  it("reads the templates", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, { templates: TEMPLATES }));

    expect(await api.fetchNotificationTemplates()).toEqual({
      outcome: "ok",
      templates: TEMPLATES,
    });
    expect(request(fetchMock).url).toBe("http://runtime.test/api/v1/notifications/templates");
  });

  it("reads the sender domain and refuses an unknown status", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, DOMAIN_PENDING));
    expect(await api.fetchSenderDomain()).toEqual({ outcome: "ok", senderDomain: DOMAIN_PENDING });
    expect(request(fetchMock).url).toBe("http://runtime.test/api/v1/notifications/sender-domain");

    stubFetch(
      jsonResponse(200, {
        ...DOMAIN_PENDING,
        domain: { ...DOMAIN_PENDING.domain, status: "done" },
      }),
    );
    expect((await api.fetchSenderDomain()).outcome).toBe("error");
  });

  it("passes a 401 and a 403 through as unauthorized", async () => {
    expect.hasAssertions();
    stubFetch(new Response(null, { status: 403 }));
    expect(await api.fetchNotificationSettings()).toEqual({ outcome: "unauthorized" });
  });
});

describe("writes", () => {
  it("POSTs the whole document with the version and an idempotency key", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, SETTINGS));

    const result = await api.saveNotificationSettings(SETTINGS.values, 3, "key-1");

    expect(result).toEqual({ outcome: "ok", data: SETTINGS });
    const sent = request(fetchMock);
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("http://runtime.test/api/v1/notifications/settings");
    expect(sent.body).toEqual({ ...SETTINGS.values, expectedVersion: 3 });
    expect(sent.headers["idempotency-key"]).toBe("key-1");
  });

  it("sends a null version while the shop has never saved, and reports a 409 as a conflict", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(409, { code: "CONFLICT", message: "stale" }));

    const result = await api.saveNotificationSettings(SETTINGS.values, null, "key-2");

    expect(request(fetchMock).body).toMatchObject({ expectedVersion: null });
    expect(result).toMatchObject({ outcome: "conflict", message: "stale" });
  });

  it("PUTs exactly the subject and body to the language's path", async () => {
    expect.hasAssertions();
    const saved = detail(TEMPLATES[0]!, "ar");
    const fetchMock = stubFetch(jsonResponse(200, saved));

    await api.saveTemplateCopy("order_confirmation", "ar", { subject: "s", body: "b" }, "key-3");

    const sent = request(fetchMock);
    expect(sent.method).toBe("PUT");
    expect(sent.url).toBe(
      "http://runtime.test/api/v1/notifications/templates/order_confirmation/ar",
    );
    expect(sent.body).toEqual({ subject: "s", body: "b" });
  });

  it("DELETEs the language's copy", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, detail(TEMPLATES[0]!, "en")));

    await api.revertTemplateCopy("order_confirmation", "en");

    const sent = request(fetchMock);
    expect(sent.method).toBe("DELETE");
    expect(sent.url).toBe(
      "http://runtime.test/api/v1/notifications/templates/order_confirmation/en",
    );
  });

  it("previews with a body of exactly locale, subject and body (the route is strict)", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(
      jsonResponse(200, { subject: "s", html: "<p>b</p>", unknownVariables: [] }),
    );

    await api.previewTemplateCopy("order_confirmation", {
      locale: "en",
      subject: "s",
      body: "b",
      key: "order_confirmation",
    } as never);

    const sent = request(fetchMock);
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(
      "http://runtime.test/api/v1/notifications/templates/order_confirmation/preview",
    );
    expect(sent.body).toEqual({ locale: "en", subject: "s", body: "b" });
  });

  it("sends the test mail with no recipient in the body", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(jsonResponse(200, { sent: true }));

    const result = await api.sendTemplateTest("order_refunded", {
      locale: "ar",
      subject: "s",
      body: "b",
    });

    expect(result).toEqual({ outcome: "ok", data: { sent: true } });
    const sent = request(fetchMock);
    expect(sent.url).toBe("http://runtime.test/api/v1/notifications/templates/order_refunded/test");
    expect(sent.body).toEqual({ locale: "ar", subject: "s", body: "b" });
  });

  it("authenticates and verifies the domain with an empty body and an idempotency key", async () => {
    expect.hasAssertions();
    const startMock = stubFetch(jsonResponse(200, DOMAIN_PENDING));
    await api.startSenderDomain("key-4");
    expect(request(startMock)).toMatchObject({
      method: "POST",
      url: "http://runtime.test/api/v1/notifications/sender-domain",
      body: {},
    });
    expect(request(startMock).headers["idempotency-key"]).toBe("key-4");

    const verifyMock = stubFetch(jsonResponse(200, DOMAIN_PENDING));
    await api.verifySenderDomain("key-5");
    expect(request(verifyMock)).toMatchObject({
      method: "POST",
      url: "http://runtime.test/api/v1/notifications/sender-domain/verify",
      body: {},
    });
  });

  it("reports the provider's 502 and a missing key's 503 with their status", async () => {
    expect.hasAssertions();
    stubFetch(jsonResponse(502, { code: "PROVIDER_ERROR", message: "x" }));
    expect(await api.verifySenderDomain("k")).toMatchObject({ outcome: "error", status: 502 });

    stubFetch(jsonResponse(503, { code: "NOT_CONFIGURED", message: "x" }));
    expect(await api.startSenderDomain("k")).toMatchObject({
      outcome: "error",
      status: 503,
      code: "NOT_CONFIGURED",
    });
  });
});
