import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  fetchNotificationsPage,
  fetchNotification,
  createNotification,
  queueNotification,
  sendNotification,
  retryNotification,
  advanceNotification,
  recordNotificationCallback,
} = await import("./notifications");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const NOTIFICATION: unknown = {
  id: "notification-1",
  idempotencyKey: "key-1",
  sourceRef: "order-1",
  recipientRef: "customer-1",
  channels: ["email"],
  currentChannel: "email",
  templateId: "template-1",
  status: "created",
  attempts: [],
  history: [{ status: "created", occurredAt: "2026-01-01T00:00:00.000Z" }],
  deliveredAt: null,
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchNotificationsPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = { items: [NOTIFICATION], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchNotificationsPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/notifications?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchNotificationsPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchNotification", () => {
  it("returns the notification on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, NOTIFICATION));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchNotification("notification-1");

    expect(result).toEqual({ outcome: "ok", notification: NOTIFICATION });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchNotification("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("createNotification", () => {
  it("sends idempotencyKey in both the body and the header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "notification-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      sourceRef: "order-1",
      recipientRef: "customer-1",
      channels: ["email"],
      templateId: "template-1",
      bodyPattern: "Hello {name}",
      variables: { name: "Ada" },
      maxAttempts: 3,
    };
    const result = await createNotification(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "notification-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ ...input, idempotencyKey: "key-1" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "bodyPattern", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createNotification(
      {
        sourceRef: "s",
        recipientRef: "r",
        channels: ["email"],
        templateId: "t",
        bodyPattern: "",
        variables: {},
        maxAttempts: 1,
      },
      "key-1",
    );

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "bodyPattern", message: "must not be empty" }],
    });
  });
});

describe("queueNotification", () => {
  it("posts to the queue route with the idempotency header, no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await queueNotification("notification-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1/queue");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("sendNotification", () => {
  it("posts to the send route without an idempotency header (not idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await sendNotification("notification-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1/send");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});

describe("retryNotification", () => {
  it("posts to the retry route with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await retryNotification("notification-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1/retry");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("advanceNotification", () => {
  it("posts toStatus to the transitions route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await advanceNotification("notification-1", "cancelled", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "cancelled" });
  });
});

describe("recordNotificationCallback", () => {
  it("posts provider/callbackId/kind without an idempotency header (not idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { provider: "sendgrid", callbackId: "cb-1", kind: "delivered" };
    const result = await recordNotificationCallback("notification-1", input);

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/notifications/notification-1/callback");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});
