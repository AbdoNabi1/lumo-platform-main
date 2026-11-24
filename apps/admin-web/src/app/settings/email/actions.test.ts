import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { Dictionary } from "@/messages/en";

/**
 * These tests run the REAL `mutateAdminApi` (only `fetch`, the session and the cookies are faked), so an exact API
 * envelope travels through the same code the browser's server action uses.
 */
const state = vi.hoisted(() => ({ locale: "ar" as string | undefined }));
const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn(), readSession: vi.fn() }));
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

import { sendTestEmailAction } from "./actions";

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
const sent = (status: string, errorCode: string | null = null) => ({
  outboundId: "out-1",
  status,
  providerMessageId: null,
  acceptedAt: null,
  errorCode,
});

const KEY = "11111111-2222-3333-4444-555555555555";
const input = { to: "owner@example.com", idempotencyKey: KEY };

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

describe("sendTestEmailAction: the request", () => {
  it("posts the address with the form's key to the email test-send route", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent("accepted")));
    await sendTestEmailAction(input);
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/email\/test-send$/);
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({ to: "owner@example.com" });
  });

  it("accepts a key up to the API's 200-character limit and refuses a longer one without calling the API", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent("accepted")));
    const longest = "k".repeat(200);
    expect((await sendTestEmailAction({ to: input.to, idempotencyKey: longest })).status).toBe(
      "result",
    );
    expect(lastRequest().init.headers["idempotency-key"]).toBe(longest);
    fetchMock.mockClear();
    expect(await sendTestEmailAction({ to: input.to, idempotencyKey: "k".repeat(201) })).toEqual({
      status: "refused",
      message: ar.emailSettings.test.toInvalid,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "nope", "a@b", "a b@c.co", `${"a".repeat(250)}@c.co`])(
    "refuses the address %j before any API call",
    async (to) => {
      expect.hasAssertions();
      expect(await sendTestEmailAction({ to, idempotencyKey: KEY })).toEqual({
        status: "refused",
        message: ar.emailSettings.test.toInvalid,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed key", async () => {
    expect.hasAssertions();
    expect((await sendTestEmailAction({ to: input.to, idempotencyKey: "x" })).status).toBe(
      "refused",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendTestEmailAction: results are delivery STATUS, never 'sent' because of HTTP 200", () => {
  it.each([
    ["accepted", "accepted", "resultAccepted"],
    ["sent", "accepted", "resultAccepted"],
    ["delivered", "accepted", "resultAccepted"],
    ["suppressed", "suppressed", "resultSuppressed"],
    ["unknown", "unknown", "resultUnknown"],
    ["pending", "unknown", "resultUnknown"],
    ["failed", "failed", "resultFailed"],
  ] as const)("maps status %s to the %s copy", async (status, outcome, key) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent(status)));
    expect(await sendTestEmailAction(input)).toEqual({
      status: "result",
      outcome,
      message: ar.emailSettings.test[key],
    });
  });

  it("a failed result with an allowlisted code adds its copy; a provider reason never appears", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent("failed", "EMAIL_CAP_REACHED")));
    expect(await sendTestEmailAction(input)).toEqual({
      status: "result",
      outcome: "failed",
      message: `${ar.emailSettings.test.resultFailed} ${ar.emailSettings.errors.EMAIL_CAP_REACHED}`,
    });
    fetchMock.mockImplementation(async () => json(200, sent("failed", "invalid_api_key")));
    const result = await sendTestEmailAction(input);
    expect(result).toEqual({
      status: "result",
      outcome: "failed",
      message: ar.emailSettings.test.resultFailed,
    });
    expect(JSON.stringify(result)).not.toContain("invalid_api_key");
  });

  it("never claims the email was sent or delivered for an accepted result", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, sent("accepted")));
    state.locale = "en";
    const result = await sendTestEmailAction(input);
    expect(result.message).toBe(en.emailSettings.test.resultAccepted);
    expect(result.message).not.toMatch(/\b(sent|delivered)\b/i);
  });
});

describe("client error mapping (R2-O04): the exact 409 envelope through mutateAdminApi", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("localises every allowlisted email code in %s", async (locale, t: Dictionary) => {
    expect.hasAssertions();
    state.locale = locale;
    const codes = Object.keys(t.emailSettings.errors).filter((c) => c !== "generic");
    expect(codes).toEqual(
      expect.arrayContaining([
        "EMAIL_CAP_REACHED",
        "EMAIL_NOT_CONFIGURED",
        "EMAIL_MARKETING_NOT_AVAILABLE",
      ]),
    );
    for (const code of codes) {
      fetchMock.mockImplementation(async () => conflict(code));
      expect(await sendTestEmailAction(input), code).toEqual({
        status: "refused",
        message: (t.emailSettings.errors as Record<string, string>)[code],
      });
    }
  });

  it("an unknown code, a provider code and provider prose are NOT proof of zero dispatch: unresolved (status error), generic copy, never the text", async () => {
    expect.hasAssertions();
    for (const text of [
      "invalid_api_key",
      "HTTP_500",
      "Resend said: re_AbC123 is not a valid key",
      "SOMETHING_NEW",
      "generic",
    ]) {
      fetchMock.mockImplementation(async () => conflict(text));
      const result = await sendTestEmailAction(input);
      expect(result).toEqual({ status: "error", message: ar.emailSettings.errors.generic });
      expect(JSON.stringify(result)).not.toMatch(/invalid_api_key|HTTP_|re_AbC123|Resend said/);
    }
  });

  it.each([
    [401, ar.formErrors.unauthorized],
    [403, ar.formErrors.forbidden],
    [404, ar.formErrors.notFound],
    [422, ar.emailSettings.test.toInvalid],
  ])(
    "a definitive HTTP %s refusal answers with its localised sentence",
    async (status, message) => {
      expect.hasAssertions();
      fetchMock.mockImplementation(async () =>
        json(status, { code: "X", message: "provider text", fields: [] }),
      );
      const result = await sendTestEmailAction(input);
      expect(result).toEqual({ status: "refused", message });
      expect(JSON.stringify(result)).not.toContain("provider text");
    },
  );

  it("a 5xx, a network failure and an unreadable answer are unresolved (status error), generic copy", async () => {
    expect.hasAssertions();
    const generic = { status: "error", message: ar.emailSettings.errors.generic };
    fetchMock.mockImplementation(async () => json(500, { message: "provider text" }));
    expect(await sendTestEmailAction(input)).toEqual(generic);
    fetchMock.mockReset().mockRejectedValue(new Error("socket hang up"));
    expect(await sendTestEmailAction(input)).toEqual(generic);
    fetchMock.mockReset().mockImplementation(async () => json(200, { nonsense: true }));
    expect(await sendTestEmailAction(input)).toEqual(generic);
  });
});

/** The transport's exact answer while the SAME Idempotency-Key is still running (`packages/http/src/server.ts`). */
function inFlight(): Response {
  return json(409, {
    code: "CONFLICT",
    message: "A request with this Idempotency-Key is already in flight",
    retryable: true,
    fields: [],
  });
}

describe("ambiguous 409s are not zero-dispatch refusals (I1)", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "409 SEND_OUTCOME_UNRECORDED (sent, outcome not recorded) is an UNKNOWN result in %s",
    async (locale, t: Dictionary) => {
      expect.hasAssertions();
      state.locale = locale;
      fetchMock.mockImplementation(async () => conflict("SEND_OUTCOME_UNRECORDED"));
      expect(await sendTestEmailAction(input)).toEqual({
        status: "result",
        outcome: "unknown",
        message: t.emailSettings.test.resultUnknown,
      });
    },
  );

  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "the transport's in-flight 409 (retryable: true) is unresolved with generic copy in %s, never its prose",
    async (locale, t: Dictionary) => {
      expect.hasAssertions();
      state.locale = locale;
      fetchMock.mockImplementation(async () => inFlight());
      const result = await sendTestEmailAction(input);
      expect(result).toEqual({ status: "error", message: t.emailSettings.errors.generic });
      expect(JSON.stringify(result)).not.toMatch(/Idempotency|in flight/i);
    },
  );

  it("an in-flight 409 stays unresolved even when its message names a known code", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(409, { code: "CONFLICT", message: "EMAIL_CAP_REACHED", retryable: true, fields: [] }),
    );
    expect(await sendTestEmailAction(input)).toEqual({
      status: "error",
      message: ar.emailSettings.errors.generic,
    });
  });

  it("safe cap / configuration / validation refusals stay definitive", async () => {
    expect.hasAssertions();
    for (const code of [
      "EMAIL_CAP_REACHED",
      "EMAIL_NOT_CONFIGURED",
      "EMAIL_MARKETING_NOT_AVAILABLE",
    ]) {
      fetchMock.mockImplementation(async () => conflict(code));
      expect((await sendTestEmailAction(input)).status, code).toBe("refused");
    }
    fetchMock.mockImplementation(async () =>
      json(422, { code: "VALIDATION", message: "Invalid", retryable: false, fields: [] }),
    );
    expect(await sendTestEmailAction(input)).toEqual({
      status: "refused",
      message: ar.emailSettings.test.toInvalid,
    });
  });

  it("revalidates /settings/email for both ambiguous cases", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("SEND_OUTCOME_UNRECORDED"));
    await sendTestEmailAction(input);
    fetchMock.mockImplementation(async () => inFlight());
    await sendTestEmailAction(input);
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/settings/email",
      "/settings/email",
    ]);
  });
});

describe("revalidation", () => {
  const cases: [string, () => void][] = [
    ["ok", () => fetchMock.mockImplementation(async () => json(200, sent("accepted")))],
    [
      "an API refusal",
      () => fetchMock.mockImplementation(async () => conflict("EMAIL_CAP_REACHED")),
    ],
    [
      "a validation refusal",
      () => fetchMock.mockImplementation(async () => json(422, { fields: [] })),
    ],
    ["a 5xx", () => fetchMock.mockImplementation(async () => json(503, {}))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("socket hang up"))],
  ];
  it.each(cases)("revalidates /settings/email on %s", async (_name, arrange) => {
    expect.hasAssertions();
    arrange();
    await sendTestEmailAction(input);
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/settings/email"]);
  });

  it("revalidates when the call throws, and still returns localised copy", async () => {
    expect.hasAssertions();
    mocks.readSession.mockRejectedValue(new Error("boom"));
    expect(await sendTestEmailAction(input)).toEqual({
      status: "error",
      message: ar.emailSettings.errors.generic,
    });
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/settings/email"]);
  });

  it("rethrows a Next redirect after revalidating instead of swallowing it", async () => {
    expect.hasAssertions();
    const { getRedirectError } = await import("next/dist/client/components/redirect");
    const { RedirectType } = await import("next/dist/client/components/redirect-error");
    const redirect = getRedirectError("/login", RedirectType.push);
    mocks.readSession.mockRejectedValue(redirect);
    await expect(sendTestEmailAction(input)).rejects.toBe(redirect);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/email");
  });
});
