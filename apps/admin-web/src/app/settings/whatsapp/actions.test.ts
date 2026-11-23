import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { Dictionary } from "@/messages/en";

/**
 * These tests run the REAL `mutateAdminApi` (only `fetch`, the session and the cookies are faked), so an exact API
 * envelope travels through the same code the browser's server action uses.
 */
const state = vi.hoisted(() => ({ locale: "ar" as string | undefined }));
const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  readSession: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "morbeh-locale" && state.locale !== undefined
          ? { value: state.locale }
          : undefined,
    }),
}));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ readSession: mocks.readSession }));

import {
  abandonOnboardingAction,
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  refreshWhatsAppAction,
  testSendAction,
} from "./actions";

const fetchMock = vi.fn();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The exact envelope `present()` + `toErrorEnvelope` put on the wire for a feature rejection. */
function conflict(code: string): Response {
  return json(409, { code: "CONFLICT", message: code, retryable: false, fields: [] });
}

const connection = {
  available: true,
  status: "connected",
  displayPhoneNumber: "+20 100 123 4567",
  verifiedName: "Nour Store",
  qualityRating: "GREEN",
  messagingLimitTier: "TIER_250",
  connectedAt: "2026-11-20T10:00:00.000Z",
  lastError: null,
  onboardingFailure: null,
  onboardingStage: null,
  version: 3,
};

const sent = (status: string, errorCode: string | null = null) => ({
  outboundId: "out-1",
  status,
  providerMessageId: null,
  acceptedAt: null,
  errorCode,
});

const KEY = "11111111-2222-3333-4444-555555555555";
const testInput = {
  to: "+201001234567",
  templateName: "order_update",
  language: "en",
  values: { body: ["Mona", "1001"] },
  idempotencyKey: KEY,
};

function lastRequest(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const call = fetchMock.mock.calls.at(-1) as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
  return { url: call[0], init: call[1] };
}

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
  fetchMock.mockReset();
  state.locale = "ar";
  mocks.readSession.mockResolvedValue(null);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ALLOWLIST = Object.keys(en.whatsappSettings.errors).filter(
  (code) => code !== "generic" && code !== "stale",
);

describe("client error mapping (R2-O04): the exact 409 envelope through mutateAdminApi", () => {
  it.each([
    [
      "en",
      "The selected phone number doesn't belong to the WhatsApp business account. Start setup again and select matching assets.",
    ],
    [
      "ar",
      "رقم التليفون المختار مش تابع لحساب WhatsApp للأعمال. ابدأ الإعداد تاني واختار الأصول المتطابقة.",
    ],
  ])("maps the META_ASSET_MISMATCH 409 for connect in %s", async (locale, message) => {
    expect.hasAssertions();
    state.locale = locale;
    fetchMock.mockImplementation(async () => conflict("META_ASSET_MISMATCH"));
    expect(await connectWhatsAppAction({ code: "c", wabaId: "1", phoneNumberId: "2" })).toEqual({
      status: "error",
      message,
    });
  });
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("localises every allowlisted code in %s", async (locale, t: Dictionary) => {
    expect.hasAssertions();
    state.locale = locale;
    expect(ALLOWLIST.length).toBeGreaterThan(10);
    for (const code of ALLOWLIST) {
      fetchMock.mockImplementation(async () => conflict(code));
      const refreshed = await refreshWhatsAppAction();
      expect(refreshed, code).toEqual({
        status: "error",
        message: (t.whatsappSettings.errors as Record<string, string>)[code],
      });
    }
  });

  it("maps the same codes for connect, disconnect, abandon and test-send", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("WHATSAPP_NOT_CONNECTED"));
    const message = ar.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED;
    expect(await connectWhatsAppAction({ code: "c", wabaId: "1", phoneNumberId: "2" })).toEqual({
      status: "error",
      message,
    });
    expect(await disconnectWhatsAppAction(1)).toEqual({ status: "error", message });
    expect(await abandonOnboardingAction(1)).toEqual({ status: "error", message });
    expect(await testSendAction(testInput)).toEqual({ status: "error", message });
  });

  it("shows generic copy for a provider code, an unknown code and provider prose — never the text", async () => {
    expect.hasAssertions();
    for (const text of [
      "META_131056",
      "HTTP_500",
      "Meta said: (#100) Invalid parameter for token EAAB123",
      "SOMETHING_NEW",
    ]) {
      fetchMock.mockImplementation(async () => conflict(text));
      const result = await refreshWhatsAppAction();
      expect(result).toEqual({ status: "error", message: ar.whatsappSettings.errors.generic });
      expect(JSON.stringify(result)).not.toMatch(/META_|HTTP_|EAAB123|Invalid parameter/);
    }
  });

  it("a stale version (409 CONCURRENCY) gets the refresh-and-retry copy", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(409, { code: "CONCURRENCY", message: "version conflict", retryable: false, fields: [] }),
    );
    expect(await disconnectWhatsAppAction(1)).toEqual({
      status: "error",
      message: ar.whatsappSettings.errors.stale,
    });
  });

  it.each([
    [401, ar.formErrors.unauthorized],
    [403, ar.formErrors.forbidden],
    [404, ar.formErrors.notFound],
    [422, ar.formErrors.invalid],
    [500, ar.whatsappSettings.errors.generic],
  ])("answers HTTP %s with its localised sentence", async (status, message) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(status, { code: "X", message: "provider text", fields: [] }),
    );
    const result = await refreshWhatsAppAction();
    expect(result).toEqual({ status: "error", message });
    expect(JSON.stringify(result)).not.toContain("provider text");
  });

  it("falls back to the default locale's copy when the cookie is missing", async () => {
    expect.hasAssertions();
    state.locale = undefined;
    fetchMock.mockImplementation(async () => conflict("WHATSAPP_NOT_CONNECTED"));
    expect(await refreshWhatsAppAction()).toEqual({
      status: "error",
      message: en.whatsappSettings.errors.WHATSAPP_NOT_CONNECTED,
    });
  });
});

describe("revalidation: after every write that reached the API, ok or not", () => {
  const cases: readonly [string, () => Promise<unknown>, readonly string[]][] = [
    [
      "connect",
      () => connectWhatsAppAction({ code: "c", wabaId: "1", phoneNumberId: "2" }),
      ["/settings/whatsapp", "/settings/whatsapp/templates"],
    ],
    ["refresh", () => refreshWhatsAppAction(), ["/settings/whatsapp"]],
    [
      "disconnect",
      () => disconnectWhatsAppAction(2),
      ["/settings/whatsapp", "/settings/whatsapp/templates"],
    ],
    ["abandon", () => abandonOnboardingAction(2), ["/settings/whatsapp"]],
    ["test send", () => testSendAction(testInput), ["/settings/whatsapp"]],
  ];

  it.each(cases)("%s revalidates on ok", async (_name, run, paths) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(200, _name === "test send" ? sent("accepted") : connection),
    );
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)("%s revalidates on an API refusal", async (_name, run, paths) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("WHATSAPP_NOT_CONNECTED"));
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)("%s revalidates on a network failure", async (_name, run, paths) => {
    expect.hasAssertions();
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)(
    "%s revalidates when the call throws, and still returns localised copy",
    async (_name, run, paths) => {
      expect.hasAssertions();
      mocks.readSession.mockRejectedValue(new Error("boom"));
      const result = await run();
      expect(result).toEqual({ status: "error", message: ar.whatsappSettings.errors.generic });
      expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    },
  );

  it("rethrows a Next redirect (after revalidating) instead of swallowing it", async () => {
    expect.hasAssertions();
    const { getRedirectError } = await import("next/dist/client/components/redirect");
    const { RedirectType } = await import("next/dist/client/components/redirect-error");
    const redirect = getRedirectError("/login", RedirectType.push);
    mocks.readSession.mockRejectedValue(redirect);
    await expect(refreshWhatsAppAction()).rejects.toBe(redirect);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/whatsapp");
  });
});

describe("connectWhatsAppAction", () => {
  it("posts the three values once to the connect route and succeeds", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, connection));
    const result = await connectWhatsAppAction({
      code: "abc",
      wabaId: "111",
      phoneNumberId: "222",
    });
    expect(result).toEqual({ status: "success" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/whatsapp\/connect$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "abc",
      wabaId: "111",
      phoneNumberId: "222",
    });
    expect(init.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts a 1024-character code and the 8192 bound, refuses 8193", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, connection));
    for (const length of [1024, 8192]) {
      expect(
        await connectWhatsAppAction({ code: "x".repeat(length), wabaId: "1", phoneNumberId: "2" }),
      ).toEqual({ status: "success" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refused = await connectWhatsAppAction({
      code: "x".repeat(8193),
      wabaId: "1",
      phoneNumberId: "2",
    });
    expect(refused.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["an empty code", { code: "", wabaId: "1", phoneNumberId: "2" }],
    ["a non-decimal WABA id", { code: "c", wabaId: "12a", phoneNumberId: "2" }],
    ["a non-decimal phone id", { code: "c", wabaId: "1", phoneNumberId: "-2" }],
    ["an empty phone id", { code: "c", wabaId: "1", phoneNumberId: "" }],
    ["a 65-digit id", { code: "c", wabaId: "1".repeat(65), phoneNumberId: "2" }],
    ["a missing field", { code: "c", wabaId: "1" }],
  ])("refuses %s before reaching the API (no revalidation either)", async (_name, input) => {
    expect.hasAssertions();
    const result = await connectWhatsAppAction(
      input as { code: string; wabaId: string; phoneNumberId: string },
    );
    expect(result).toEqual({ status: "error", message: ar.whatsappSettings.signupFailed });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("version-bound actions", () => {
  it("disconnect and abandon send expectedVersion", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, connection));
    await disconnectWhatsAppAction(7);
    expect(lastRequest().url).toMatch(/\/whatsapp\/disconnect$/);
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({ expectedVersion: 7 });
    await abandonOnboardingAction(8);
    expect(lastRequest().url).toMatch(/\/whatsapp\/onboarding\/abandon$/);
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({ expectedVersion: 8 });
  });

  it.each([-1, 1.5, Number.NaN, "3" as unknown as number])(
    "refuses version %s without calling the API",
    async (version) => {
      expect.hasAssertions();
      expect((await disconnectWhatsAppAction(version)).status).toBe("error");
      expect((await abandonOnboardingAction(version)).status).toBe("error");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("testSendAction", () => {
  it("forwards the form's key and the full values, and not the key in the body", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent("accepted")));
    await testSendAction({
      ...testInput,
      values: { body: ["Mona", "1001"], header: "1001", urlSuffixes: { "2": "abc" } },
      attestConsent: true,
    });
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/whatsapp\/test-send$/);
    expect(init.headers["idempotency-key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      to: "+201001234567",
      templateName: "order_update",
      language: "en",
      values: { body: ["Mona", "1001"], header: "1001", urlSuffixes: { "2": "abc" } },
      attestConsent: true,
    });
  });

  it.each([
    ["accepted", "accepted", ar.whatsappSettings.test.resultAccepted],
    ["delivered", "accepted", ar.whatsappSettings.test.resultAccepted],
    ["suppressed", "suppressed", ar.whatsappSettings.test.resultSuppressed],
    ["unknown", "unknown", ar.whatsappSettings.test.resultUnknown],
    ["pending", "unknown", ar.whatsappSettings.test.resultUnknown],
    ["failed", "failed", ar.whatsappSettings.test.resultFailed],
  ])("maps the API status %s to the %s copy", async (status, outcome, message) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent(status)));
    expect(await testSendAction(testInput)).toEqual({ status: "result", outcome, message });
  });

  it("never says 'Sent' just because the request returned 200", async () => {
    expect.hasAssertions();
    state.locale = "en";
    for (const status of ["pending", "unknown", "failed", "suppressed", "accepted"]) {
      fetchMock.mockImplementation(async () => json(200, sent(status)));
      const result = await testSendAction(testInput);
      expect(JSON.stringify(result)).not.toMatch(/\bSent\b/);
    }
  });

  it("a failed send appends the allowlisted reason, and hides a provider code", async () => {
    expect.hasAssertions();
    state.locale = "en";
    fetchMock.mockImplementation(async () => json(200, sent("failed", "AUTHORIZATION_EXPIRED")));
    const known = await testSendAction(testInput);
    expect(known).toEqual({
      status: "result",
      outcome: "failed",
      message: `${en.whatsappSettings.test.resultFailed} ${en.whatsappSettings.errors.AUTHORIZATION_EXPIRED}`,
    });
    fetchMock.mockImplementation(async () => json(200, sent("failed", "META_131056")));
    const unknown = await testSendAction(testInput);
    expect(unknown).toEqual({
      status: "result",
      outcome: "failed",
      message: en.whatsappSettings.test.resultFailed,
    });
    expect(JSON.stringify(unknown)).not.toContain("131056");
  });

  it.each([
    ["a malformed phone", { to: "hello" }],
    ["a template name with spaces", { templateName: "order update" }],
    ["a missing key", { idempotencyKey: "" }],
    ["a key with a space", { idempotencyKey: "has space 12345" }],
    ["eleven body values", { values: { body: Array.from({ length: 11 }, () => "x") } }],
    ["a non-string body value", { values: { body: [1] } }],
    ["a non-digit URL suffix index", { values: { body: [], urlSuffixes: { a: "x" } } }],
    ["a non-boolean attestation", { attestConsent: "yes" }],
  ])("refuses %s before reaching the API", async (_name, change) => {
    expect.hasAssertions();
    const result = await testSendAction({ ...testInput, ...change } as typeof testInput);
    expect(result).toEqual({ status: "error", message: ar.formErrors.invalid });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
