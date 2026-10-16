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

const { DEFAULT_STORE_SETTINGS, fetchStoreSettings, storeSettingsOrDefaults, updateStoreSettings } =
  await import("./store-settings");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settings = {
  storeName: "Lumo",
  contactEmail: "hello@lumo.test",
  currency: "SAR",
  timezone: "Asia/Riyadh",
  weightUnit: "g",
} as const;

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("store settings API (Plan 3C)", () => {
  it("reads GET /store/settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, settings));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStoreSettings();

    expect(result).toEqual({ outcome: "ok", settings });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/store/settings",
    );
  });

  it("refuses a response whose weight unit is not one of kg, g, lb, oz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...settings, weightUnit: "stone" })),
    );
    expect((await fetchStoreSettings()).outcome).toBe("error");
  });

  it("PUTs the settings with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, settings));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateStoreSettings(settings, "key-1");

    expect(result).toEqual({ outcome: "ok", data: settings });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(settings);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("storeSettingsOrDefaults falls back to EGP, Africa/Cairo, kg when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await storeSettingsOrDefaults()).toEqual(DEFAULT_STORE_SETTINGS);
    expect(DEFAULT_STORE_SETTINGS).toMatchObject({
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
    });
  });
});
