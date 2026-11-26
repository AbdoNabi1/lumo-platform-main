import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: jwtVerifyMock }));

const { fetchCheckoutSettings, saveCheckoutSettings } = await import("./checkout-settings");

const SETTINGS = {
  nameMode: "required",
  phoneMode: "required",
  line2Mode: "optional",
  marketingEmailPrompt: "hidden",
  cartLineLimit: null,
  requireLogin: false,
  accountsMode: "optional",
  showAccountLink: true,
} as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

describe("fetchCheckoutSettings", () => {
  it("reads the document with its version (null when the shop never saved)", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...SETTINGS, version: null }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCheckoutSettings();

    expect(result).toEqual({ outcome: "ok", settings: { ...SETTINGS, version: null } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://runtime.test/api/v1/checkout/settings");
  });

  it("refuses a body with an unknown mode as an error, never as settings", async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...SETTINGS, nameMode: "hidden", version: 1 })),
    );

    expect((await fetchCheckoutSettings()).outcome).toBe("error");
  });

  it("maps 401/403 to unauthorized", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));

    expect(await fetchCheckoutSettings()).toEqual({ outcome: "unauthorized" });
  });
});

describe("saveCheckoutSettings", () => {
  it("POSTs the eight fields and expectedVersion with the idempotency key", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...SETTINGS, version: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveCheckoutSettings(SETTINGS, 3, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/checkout/settings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ...SETTINGS, expectedVersion: 3 });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("sends expectedVersion null for a shop with no row yet", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...SETTINGS, version: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveCheckoutSettings(SETTINGS, null, "key-2");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).expectedVersion).toBeNull();
  });

  it("returns a 409 as conflict and a 422 with its field issues", async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(409, { message: "These settings were changed by someone else" }),
        )
        .mockResolvedValueOnce(
          jsonResponse(422, {
            message: "Invalid checkout settings",
            fields: [
              { field: "requireLogin", message: "Customer accounts must be on to require login" },
            ],
          }),
        ),
    );

    expect(await saveCheckoutSettings(SETTINGS, 1, "k")).toMatchObject({ outcome: "conflict" });
    expect(await saveCheckoutSettings(SETTINGS, 1, "k")).toMatchObject({
      outcome: "invalid",
      fields: [{ field: "requireLogin", message: "Customer accounts must be on to require login" }],
    });
  });
});
