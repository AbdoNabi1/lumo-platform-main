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

const { mutateAdminApi, postAdminApiForBytes } = await import("./client");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("mutateAdminApi", () => {
  it("surfaces the carrier error code from a 409 envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: "CARRIER_CREDENTIALS_REJECTED",
          message: "rejected",
        }),
      ),
    );
    const result = await mutateAdminApi(
      "/api/v1/shipping/carriers/bosta",
      { method: "PUT" },
      isRecord,
    );
    expect(result).toMatchObject({ outcome: "conflict", code: "CARRIER_CREDENTIALS_REJECTED" });
  });

  it("maps a 201 with a valid body to ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "product-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: { sku: "SKU-1" } },
      isRecord,
    );

    expect(result).toEqual({ outcome: "ok", data: { id: "product-1" } });
  });

  it("maps a 422 with fields to invalid, preserving the fields", async () => {
    const envelope = {
      code: "VALIDATION",
      message: "Invalid input",
      retryable: false,
      fields: [{ field: "sku", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST", body: {} }, isRecord);

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "sku", message: "must not be empty" }],
      code: "VALIDATION",
    });
  });

  it("treats a missing or malformed fields array as empty, never crashes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { code: "VALIDATION", message: "bad" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST", body: {} }, isRecord);

    expect(result).toEqual({ outcome: "invalid", message: "bad", fields: [], code: "VALIDATION" });
  });

  it("maps a 409 to conflict, using the API's own message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { code: "CONFLICT", message: "already in flight" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products/p1",
      { method: "POST", body: {} },
      isRecord,
    );

    expect(result).toEqual({ outcome: "conflict", message: "already in flight", code: "CONFLICT" });
  });

  it("maps a 401 to unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 403 to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "forbidden" });
  });

  it("maps a 404 to not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products/p1", { method: "DELETE" }, isRecord);
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a thrown fetch to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("sends the idempotency-key header when idempotencyKey is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: {}, idempotencyKey: "key-1" },
      isRecord,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("does not send the idempotency-key header when idempotencyKey is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await mutateAdminApi("/api/v1/products", { method: "POST", body: {} }, isRecord);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("maps a 2xx whose body fails isValid to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, "not an object"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result.outcome).toBe("error");
  });
});

describe("postAdminApiForBytes", () => {
  it("returns the response bytes on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70])));
    vi.stubGlobal("fetch", fetchMock);
    const result = await postAdminApiForBytes("/api/v1/shipments/awb", { orderIds: ["a"] }, 1000);
    expect(result).toEqual({ outcome: "ok", bytes: new Uint8Array([37, 80, 68, 70]) });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ orderIds: ["a"] }));
  });

  it("maps 409 to conflict with the order numbers and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(409, { code: "AWB_NOT_AVAILABLE", orderNumbers: ["1001", 5, "1002"] }),
        ),
    );
    expect(await postAdminApiForBytes("/x", {})).toEqual({
      outcome: "conflict",
      code: "AWB_NOT_AVAILABLE",
      orderNumbers: ["1001", "1002"],
    });
  });

  it("maps 401/403, 404, other statuses and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    expect(await postAdminApiForBytes("/x", {})).toEqual({ outcome: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    expect(await postAdminApiForBytes("/x", {})).toEqual({ outcome: "not_found" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    expect(await postAdminApiForBytes("/x", {})).toMatchObject({ outcome: "error" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await postAdminApiForBytes("/x", {})).toEqual({ outcome: "error", message: "down" });
  });
});
