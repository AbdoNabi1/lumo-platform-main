import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdPlatformFormState,
  AdPlatformTestState,
  ConnectionViewDto,
} from "@/lib/ad-platforms-model";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  fetchAdPlatforms: vi.fn(),
  saveAdPlatform: vi.fn(),
  sendAdPlatformTestEvent: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const revalidateStorefront = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/ad-platforms", () => ({
  fetchAdPlatforms: api.fetchAdPlatforms,
  saveAdPlatform: api.saveAdPlatform,
  sendAdPlatformTestEvent: api.sendAdPlatformTestEvent,
}));
vi.mock("@/lib/storefront-revalidate", () => ({ revalidateStorefront }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { saveAdPlatformAction, sendAdPlatformTestEventAction } = await import("./actions");

const idle: AdPlatformFormState = { status: "idle" };
const SECRET = "fake-secret-value-1234";
const copy = en.adPlatformsSettings;

function view(overrides: Partial<ConnectionViewDto> = {}): ConnectionViewDto {
  return {
    platform: "meta",
    enabled: true,
    publicConfig: { platform: "meta", pixelId: "12345678901234" },
    secret: { configured: true, last4: "1234" },
    testEventCode: null,
    complete: true,
    live: true,
    version: 4,
    ...overrides,
  };
}

function form(entries: Record<string, string | undefined>): FormData {
  const formData = new FormData();
  const fields: Record<string, string | undefined> = {
    platform: "meta",
    expectedVersion: "3",
    enabled: "on",
    pixelId: "12345678901234",
    ...entries,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.append(key, value);
  }
  return formData;
}

function sent(call = 0): { platform: string; input: Record<string, unknown>; key: string } {
  const args = api.saveAdPlatform.mock.calls[call] as [string, Record<string, unknown>, string];
  return { platform: args[0], input: args[1], key: args[2] };
}

beforeEach(() => {
  api.fetchAdPlatforms.mockReset().mockResolvedValue({
    outcome: "ok",
    items: [view({ version: 3, enabled: true })],
  });
  api.saveAdPlatform.mockReset().mockResolvedValue({ outcome: "ok", data: view() });
  api.sendAdPlatformTestEvent.mockReset();
  revalidatePath.mockReset();
  revalidateStorefront.mockReset().mockResolvedValue(true);
});

describe("saveAdPlatformAction", () => {
  it("saves one platform with the version the card loaded and returns the new view", async () => {
    expect.hasAssertions();
    const state = await saveAdPlatformAction(idle, form({}));

    expect(state).toEqual({ status: "success", view: view() });
    expect(sent()).toMatchObject({
      platform: "meta",
      input: {
        enabled: true,
        publicConfig: { pixelId: "12345678901234" },
        expectedVersion: 3,
      },
    });
    expect(sent().key).toEqual(expect.any(String));
  });

  it("a blank token sends no secret and no clearSecret: the saved one is kept", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ secret: "" }));
    await saveAdPlatformAction(idle, form({ secret: "   " }));
    await saveAdPlatformAction(idle, form({}));

    for (const call of [0, 1, 2]) {
      const { input } = sent(call);
      expect(input["secret"], `call ${call}`).toBeUndefined();
      expect(input["clearSecret"], `call ${call}`).toBeUndefined();
    }
  });

  it("a typed token is sent (trimmed) but never comes back in the state", async () => {
    expect.hasAssertions();
    const state = await saveAdPlatformAction(idle, form({ secret: `  ${SECRET}  ` }));

    expect(sent().input["secret"]).toBe(SECRET);
    expect(JSON.stringify(state)).not.toContain(SECRET);

    api.saveAdPlatform.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid ad platform connection",
      fields: [{ field: "secret", message: SECRET }],
    });
    const refused = await saveAdPlatformAction(idle, form({ secret: SECRET }));
    expect(refused.status).toBe("error");
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });

  it("Remove token sends clearSecret true and no secret", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ clearSecret: "on" }));

    expect(sent().input["clearSecret"]).toBe(true);
    expect(sent().input["secret"]).toBeUndefined();
  });

  it("refuses a new token together with Remove token, without any request", async () => {
    expect.hasAssertions();
    const state = await saveAdPlatformAction(idle, form({ secret: SECRET, clearSecret: "on" }));

    expect(state.status).toBe("error");
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(api.saveAdPlatform).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("an unticked switch is saved as off", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ enabled: undefined }));

    expect(sent().input["enabled"]).toBe(false);
  });

  it("no ids typed sends publicConfig null", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ enabled: undefined, pixelId: "  " }));

    expect(sent().input["publicConfig"]).toBeNull();
  });

  it("sends each platform's own id: TikTok pixelCode, GA4 measurementId, Snapchat pixelId", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ platform: "tiktok", pixelCode: "ABCDEFGHIJ" }));
    await saveAdPlatformAction(idle, form({ platform: "ga4", measurementId: "G-ABCD1234" }));
    await saveAdPlatformAction(
      idle,
      form({ platform: "snap", pixelId: "12345678-1234-1234-1234-123456789012" }),
    );

    expect(sent(0).input["publicConfig"]).toEqual({ pixelCode: "ABCDEFGHIJ" });
    expect(sent(1).input["publicConfig"]).toEqual({ measurementId: "G-ABCD1234" });
    expect(sent(2).input["publicConfig"]).toEqual({
      pixelId: "12345678-1234-1234-1234-123456789012",
    });
  });

  it("Google Ads sends the conversion id and only the labels that have text", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(
      idle,
      form({
        platform: "google_ads",
        conversionId: "AW-123456789",
        labelLead: "leadLabel_1",
        labelContact: "",
        labelPurchase: "buyLabel-2",
        pixelId: undefined,
      }),
    );

    expect(sent().platform).toBe("google_ads");
    expect(sent().input["publicConfig"]).toEqual({
      conversionId: "AW-123456789",
      labels: { lead: "leadLabel_1", purchase: "buyLabel-2" },
    });
  });

  it("the test event code goes only for Meta and TikTok; blank removes it", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ testEventCode: " TEST123 " }));
    await saveAdPlatformAction(idle, form({ testEventCode: "" }));
    await saveAdPlatformAction(idle, form({}));
    await saveAdPlatformAction(
      idle,
      form({ platform: "ga4", measurementId: "G-ABCD1234", testEventCode: "TEST123" }),
    );

    expect(sent(0).input["testEventCode"]).toBe("TEST123");
    expect(sent(1).input["testEventCode"]).toBeNull();
    expect("testEventCode" in sent(2).input).toBe(false);
    expect("testEventCode" in sent(3).input).toBe(false);
  });

  it("sends version 0 for a platform with no row yet", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({ expectedVersion: "0" }));

    expect(sent().input["expectedVersion"]).toBe(0);
  });

  it("maps a 422's field issues onto the card's inputs, in the page's words", async () => {
    expect.hasAssertions();
    api.saveAdPlatform.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid public configuration",
      fields: [
        { field: "publicConfig.pixelId", message: "invalid value" },
        { field: "publicConfig.labels.lead", message: "invalid value" },
        { field: "secret", message: "must be 10–1024 characters" },
        { field: "testEventCode", message: "invalid value" },
        { field: "expectedVersion", message: "whatever" },
      ],
    });

    const state = await saveAdPlatformAction(idle, form({}));

    expect(state).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {
        pixelId: copy.fieldInvalid,
        labelLead: copy.fieldInvalid,
        secret: copy.tokenInvalid,
        testEventCode: copy.fieldInvalid,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ad-platforms");
  });

  it("maps a 409 to the reload message with conflict true", async () => {
    expect.hasAssertions();
    api.saveAdPlatform.mockResolvedValue({ outcome: "conflict", message: "stale" });

    const state = await saveAdPlatformAction(idle, form({}));

    expect(state).toEqual({ status: "error", message: copy.conflict, conflict: true });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ad-platforms");
  });

  it("maps a 503 UNAVAILABLE (no token vault) to 'Not available yet'", async () => {
    expect.hasAssertions();
    api.saveAdPlatform.mockResolvedValue({
      outcome: "error",
      message: "Admin API responded with status 503",
      status: 503,
      code: "UNAVAILABLE",
    });

    const state = await saveAdPlatformAction(idle, form({ secret: SECRET }));

    expect(state).toEqual({ status: "error", message: copy.unavailable });
    expect(copy.unavailable).toContain("Not available yet");
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it.each([
    ["unauthorized", en.formErrors.unauthorized],
    ["forbidden", en.formErrors.forbidden],
    ["not_found", en.formErrors.notFound],
    ["error", en.formErrors.unexpected],
  ] as const)("a %s save is an error that still refreshes the page", async (outcome, message) => {
    expect.hasAssertions();
    api.saveAdPlatform.mockResolvedValue({ outcome, message: "x" });

    const state = await saveAdPlatformAction(idle, form({}));

    expect(state).toMatchObject({ status: "error", message });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ad-platforms");
    expect(revalidateStorefront).not.toHaveBeenCalled();
  });

  it("refreshes the settings page after every call that reached the API, ok or not", async () => {
    expect.hasAssertions();
    await saveAdPlatformAction(idle, form({}));
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenLastCalledWith("/settings/ad-platforms");

    api.saveAdPlatform.mockResolvedValue({ outcome: "conflict", message: "stale" });
    await saveAdPlatformAction(idle, form({}));
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("refuses a tampered platform, version or field without any request or refresh", async () => {
    expect.hasAssertions();
    const states = [
      await saveAdPlatformAction(idle, form({ platform: "x" })),
      await saveAdPlatformAction(idle, form({ platform: undefined })),
      await saveAdPlatformAction(idle, form({ expectedVersion: "x" })),
      await saveAdPlatformAction(idle, form({ expectedVersion: "-1" })),
      await saveAdPlatformAction(idle, form({ expectedVersion: "" })),
    ];

    for (const state of states) expect(state).toMatchObject({ status: "error" });
    expect(api.saveAdPlatform).not.toHaveBeenCalled();
    expect(api.fetchAdPlatforms).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  describe("storefront refresh", () => {
    it("tells the storefront after an ok save that changed enabled", async () => {
      expect.hasAssertions();
      api.fetchAdPlatforms.mockResolvedValue({
        outcome: "ok",
        items: [view({ enabled: false, live: false, version: 3 })],
      });

      await saveAdPlatformAction(idle, form({}));

      expect(revalidateStorefront).toHaveBeenCalledTimes(1);
    });

    it("tells the storefront after an ok save that changed a public id", async () => {
      expect.hasAssertions();
      api.fetchAdPlatforms.mockResolvedValue({
        outcome: "ok",
        items: [view({ publicConfig: { platform: "meta", pixelId: "99999999999999" } })],
      });

      await saveAdPlatformAction(idle, form({}));

      expect(revalidateStorefront).toHaveBeenCalledTimes(1);
    });

    it("does not bother the storefront after a token-only save (ids and switch unchanged)", async () => {
      expect.hasAssertions();
      await saveAdPlatformAction(idle, form({ secret: SECRET }));

      expect(api.saveAdPlatform).toHaveBeenCalledTimes(1);
      expect(revalidateStorefront).not.toHaveBeenCalled();
    });

    it("tells the storefront when it could not read what was there before", async () => {
      expect.hasAssertions();
      api.fetchAdPlatforms.mockResolvedValue({ outcome: "error", message: "boom" });

      await saveAdPlatformAction(idle, form({}));

      expect(revalidateStorefront).toHaveBeenCalledTimes(1);
    });

    it("never tells the storefront after a refused save", async () => {
      expect.hasAssertions();
      api.saveAdPlatform.mockResolvedValue({ outcome: "conflict", message: "stale" });

      await saveAdPlatformAction(idle, form({ enabled: undefined }));

      expect(revalidateStorefront).not.toHaveBeenCalled();
    });
  });
});

describe("sendAdPlatformTestEventAction", () => {
  const idleTest: AdPlatformTestState = { status: "idle" };
  const RESULT = {
    platform: "meta",
    status: "sent",
    vendorStatus: 200,
    sentAt: "2026-11-28T10:00:00.000Z",
  } as const;

  function testForm(entries: Record<string, string | undefined>): FormData {
    const formData = new FormData();
    for (const [key, value] of Object.entries({ platform: "meta", ...entries })) {
      if (value !== undefined) formData.append(key, value);
    }
    return formData;
  }

  it("sends one test for the platform with no code when none was typed, and refreshes the page", async () => {
    expect.hasAssertions();
    api.sendAdPlatformTestEvent.mockResolvedValue({ outcome: "ok", data: RESULT });

    const state = await sendAdPlatformTestEventAction(idleTest, testForm({}));

    expect(state).toEqual({ status: "done", platform: "meta", result: RESULT });
    expect(api.sendAdPlatformTestEvent).toHaveBeenCalledWith("meta", undefined);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ad-platforms");
    // A test is not a save: nothing is stored, and the storefront has nothing new to show.
    expect(api.saveAdPlatform).not.toHaveBeenCalled();
    expect(revalidateStorefront).not.toHaveBeenCalled();
  });

  it("passes the typed code (trimmed) for this one test", async () => {
    expect.hasAssertions();
    api.sendAdPlatformTestEvent.mockResolvedValue({ outcome: "ok", data: RESULT });

    await sendAdPlatformTestEventAction(idleTest, testForm({ testEventCode: "  TEST_ab-9 " }));

    expect(api.sendAdPlatformTestEvent).toHaveBeenCalledWith("meta", "TEST_ab-9");
  });

  it("refuses a malformed code, a platform without a test and a missing platform before any request", async () => {
    expect.hasAssertions();

    expect(
      await sendAdPlatformTestEventAction(idleTest, testForm({ testEventCode: "has space" })),
    ).toEqual({ status: "failed", platform: "meta", reason: "invalid_code" });
    expect(
      await sendAdPlatformTestEventAction(idleTest, testForm({ testEventCode: "x".repeat(65) })),
    ).toMatchObject({ status: "failed", reason: "invalid_code" });
    expect(
      await sendAdPlatformTestEventAction(idleTest, testForm({ platform: "google_ads" })),
    ).toMatchObject({ status: "failed", reason: "unexpected" });
    expect(
      await sendAdPlatformTestEventAction(idleTest, testForm({ platform: "pinterest" })),
    ).toMatchObject({ status: "failed", reason: "unexpected" });
    expect(
      await sendAdPlatformTestEventAction(idleTest, testForm({ platform: undefined })),
    ).toMatchObject({ status: "failed", reason: "unexpected" });
    expect(api.sendAdPlatformTestEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the vendor answer (rejected, messages) as the result, not as an error", async () => {
    expect.hasAssertions();
    const rejected = {
      platform: "ga4",
      status: "rejected",
      vendorStatus: 200,
      messages: ["events[0].name: bad"],
      sentAt: RESULT.sentAt,
    } as const;
    api.sendAdPlatformTestEvent.mockResolvedValue({ outcome: "ok", data: rejected });

    const state = await sendAdPlatformTestEventAction(idleTest, testForm({ platform: "ga4" }));

    expect(state).toEqual({ status: "done", platform: "ga4", result: rejected });
  });

  it.each([
    [{ outcome: "conflict", message: "m", code: "NOT_CONNECTED" }, "not_connected"],
    [{ outcome: "invalid", message: "m", fields: [], code: "TEST_CODE_REQUIRED" }, "code_required"],
    [{ outcome: "invalid", message: "m", fields: [], code: "TEST_NOT_SUPPORTED" }, "not_supported"],
    [
      {
        outcome: "invalid",
        message: "m",
        fields: [{ field: "testEventCode", message: "x" }],
        code: "VALIDATION",
      },
      "invalid_code",
    ],
    [{ outcome: "invalid", message: "m", fields: [], code: "VALIDATION" }, "unexpected"],
    [{ outcome: "error", message: "m", status: 429, code: "RATE_LIMITED" }, "rate_limited"],
    [{ outcome: "error", message: "m", status: 503, code: "UNAVAILABLE" }, "unavailable"],
    [{ outcome: "error", message: "m", status: 503, code: "NOT_CONFIGURED" }, "unavailable"],
    [{ outcome: "error", message: "network" }, "unexpected"],
    [{ outcome: "unauthorized" }, "unauthorized"],
    [{ outcome: "forbidden" }, "forbidden"],
    [{ outcome: "not_found" }, "unavailable"],
  ])("maps %j to %s and refreshes the page", async (apiResult, reason) => {
    expect.hasAssertions();
    api.sendAdPlatformTestEvent.mockResolvedValue(apiResult);

    const state = await sendAdPlatformTestEventAction(idleTest, testForm({}));

    expect(state).toEqual({ status: "failed", platform: "meta", reason });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ad-platforms");
  });

  it("never puts the API text, a token or the typed code in what it returns", async () => {
    expect.hasAssertions();
    api.sendAdPlatformTestEvent.mockResolvedValue({
      outcome: "invalid",
      message: `Bearer ${SECRET}`,
      fields: [],
      code: "TEST_CODE_REQUIRED",
    });

    const state = await sendAdPlatformTestEventAction(
      idleTest,
      testForm({ testEventCode: "CODE1234" }),
    );

    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(JSON.stringify(state)).not.toContain("CODE1234");
  });
});
