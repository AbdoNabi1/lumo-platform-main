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

import { createTemplateAction, deleteTemplateAction, syncTemplatesAction } from "./actions";

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
/** The exact 422 the API sends for template issues: `fields:[{field, message:<issue code>}]`. */
function validation(fields: { field: string; message: string }[]): Response {
  return json(422, { code: "VALIDATION", message: "Invalid template", retryable: false, fields });
}

const row = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "PENDING",
  rejectedReason: null,
  components: [],
  variableCount: 1,
  buttons: [],
  supported: true,
  sendShape: { bodyVariableCount: 1, headerHasVariable: false, buttons: [] },
};

const KEY = "11111111-2222-3333-4444-555555555555";
const draft = {
  name: "order_update",
  language: "en",
  category: "UTILITY" as const,
  body: { text: "Hi {{1}}, your order is on its way.", examples: ["Sara"] },
};
const paths = ["/settings/whatsapp/templates", "/settings/whatsapp"];

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

const cases: [string, () => Promise<unknown>, unknown][] = [
  ["sync", () => syncTemplatesAction(), [row]],
  ["create", () => createTemplateAction({ draft, idempotencyKey: KEY }), row],
  ["delete", () => deleteTemplateAction("order_update"), { deleted: 1 }],
];

describe("revalidation (A7): the templates page AND the test-send selector, in a finally", () => {
  it.each(cases)("%s revalidates both paths on ok", async (_name, run, okBody) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, okBody));
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)("%s revalidates both paths on an API refusal", async (_name, run) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => conflict("WHATSAPP_NOT_CONNECTED"));
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)("%s revalidates both paths on a validation refusal (422)", async (_name, run) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      validation([{ field: "name", message: "name_format" }]),
    );
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)("%s revalidates both paths on a network failure", async (_name, run) => {
    expect.hasAssertions();
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await run();
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
  });

  it.each(cases)(
    "%s revalidates when the call throws and still returns copy",
    async (_name, run) => {
      expect.hasAssertions();
      mocks.readSession.mockRejectedValue(new Error("boom"));
      const result = await run();
      expect(result).toEqual({ status: "error", message: ar.whatsappTemplates.errors.generic });
      expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    },
  );

  it("rethrows a Next redirect after revalidating, instead of swallowing it", async () => {
    expect.hasAssertions();
    const { getRedirectError } = await import("next/dist/client/components/redirect");
    const { RedirectType } = await import("next/dist/client/components/redirect-error");
    const redirect = getRedirectError("/login", RedirectType.push);
    mocks.readSession.mockRejectedValue(redirect);
    await expect(syncTemplatesAction()).rejects.toBe(redirect);
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    mocks.revalidatePath.mockClear();
    await expect(deleteTemplateAction("order_update")).rejects.toBe(redirect);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    mocks.revalidatePath.mockClear();
    await expect(createTemplateAction({ draft, idempotencyKey: KEY })).rejects.toBe(redirect);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("does not revalidate when the input never reached the API", async () => {
    expect.hasAssertions();
    expect(await deleteTemplateAction("Not A Name")).toEqual({
      status: "error",
      message: ar.formErrors.invalid,
    });
    expect(
      await createTemplateAction({
        draft: { ...draft, category: "AUTH" as never },
        idempotencyKey: KEY,
      }),
    ).toEqual({ status: "refused", message: ar.formErrors.invalid });
    expect(await createTemplateAction({ draft, idempotencyKey: "short" })).toEqual({
      status: "refused",
      message: ar.formErrors.invalid,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("requests", () => {
  it("sync posts to the sync route with an idempotency key and succeeds", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, [row]));
    expect(await syncTemplatesAction()).toEqual({ status: "success" });
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/whatsapp\/templates\/sync$/);
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("delete is a DELETE by name", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(200, { deleted: 2 }));
    expect(await deleteTemplateAction("order_update")).toEqual({ status: "success" });
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/whatsapp\/templates\/order_update$/);
    expect(init.method).toBe("DELETE");
  });

  it("create sends the draft (only known keys) with the form's key", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () => json(201, row));
    const result = await createTemplateAction({
      draft: {
        ...draft,
        sneaky: "x",
        buttons: [{ type: "QUICK_REPLY", text: "Ok", extra: 1 }],
      } as never,
      idempotencyKey: KEY,
    });
    expect(result).toEqual({ status: "success" });
    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/v1\/outreach\/whatsapp\/templates$/);
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      ...draft,
      buttons: [{ type: "QUICK_REPLY", text: "Ok" }],
    });
  });
});

describe("client error mapping (R2-O04): the exact 409 envelope through mutateAdminApi", () => {
  const OWN = ["TEMPLATE_ALREADY_EXISTS", "TEMPLATE_SYNC_INCOMPLETE"];
  const SHARED = [
    "WHATSAPP_NOT_CONFIGURED",
    "WHATSAPP_NOT_CONNECTED",
    "CONNECTION_CHANGED",
    "AUTHORIZATION_EXPIRED",
    "CREDENTIALS_UNAVAILABLE",
  ];
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("localises every templates conflict code in %s", async (locale, t: Dictionary) => {
    expect.hasAssertions();
    state.locale = locale;
    for (const code of OWN) {
      fetchMock.mockImplementation(async () => conflict(code));
      const expected = (t.whatsappTemplates.errors as Record<string, string>)[code];
      expect(expected, code).toBeTypeOf("string");
      expect(await syncTemplatesAction(), code).toEqual({ status: "error", message: expected });
      expect(await deleteTemplateAction("order_update"), code).toEqual({
        status: "error",
        message: expected,
      });
      expect(await createTemplateAction({ draft, idempotencyKey: KEY }), code).toEqual({
        status: "refused",
        message: expected,
      });
    }
    for (const code of SHARED) {
      fetchMock.mockImplementation(async () => conflict(code));
      expect(await syncTemplatesAction(), code).toEqual({
        status: "error",
        message: (t.whatsappSettings.errors as Record<string, string>)[code],
      });
    }
  });

  it("shows generic copy for a provider code, an unknown code and provider prose — never the text", async () => {
    expect.hasAssertions();
    for (const text of [
      "META_131056",
      "HTTP_500",
      "Meta said: (#100) Invalid parameter for token EAAB123",
      "SOMETHING_NEW",
      "generic",
    ]) {
      fetchMock.mockImplementation(async () => conflict(text));
      const result = await syncTemplatesAction();
      expect(result).toEqual({ status: "error", message: ar.whatsappTemplates.errors.generic });
      expect(JSON.stringify(result)).not.toMatch(/META_|HTTP_|EAAB123|Invalid parameter/);
    }
  });

  it("a stale version (409 CONCURRENCY) gets the refresh-and-retry copy", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(409, { code: "CONCURRENCY", message: "version conflict", retryable: false, fields: [] }),
    );
    expect(await deleteTemplateAction("order_update")).toEqual({
      status: "error",
      message: ar.whatsappSettings.errors.stale,
    });
  });

  it.each([
    [401, ar.formErrors.unauthorized],
    [403, ar.formErrors.forbidden],
    [404, ar.formErrors.notFound],
    [500, ar.whatsappTemplates.errors.generic],
  ])("answers HTTP %s with its localised sentence", async (status, message) => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(status, { code: "X", message: "provider text", fields: [] }),
    );
    const result = await syncTemplatesAction();
    expect(result).toEqual({ status: "error", message });
    expect(JSON.stringify(result)).not.toContain("provider text");
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

describe("createTemplateAction: an ambiguous 409 is not a zero-dispatch refusal (I1)", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)(
    "the transport's in-flight 409 (retryable: true) is unresolved with generic copy in %s, never its prose",
    async (locale, t: Dictionary) => {
      expect.hasAssertions();
      state.locale = locale;
      fetchMock.mockImplementation(async () => inFlight());
      const result = await createTemplateAction({ draft, idempotencyKey: KEY });
      expect(result).toEqual({ status: "error", message: t.whatsappTemplates.errors.generic });
      expect(JSON.stringify(result)).not.toMatch(/Idempotency|in flight/i);
      expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    },
  );

  it("an in-flight 409 stays unresolved even when its message names a known code", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      json(409, {
        code: "CONFLICT",
        message: "TEMPLATE_ALREADY_EXISTS",
        retryable: true,
        fields: [],
      }),
    );
    expect((await createTemplateAction({ draft, idempotencyKey: KEY })).status).toBe("error");
  });

  it("an unknown code or provider prose is unresolved (generic copy), but a Meta refusal and every known code stay definitive", async () => {
    expect.hasAssertions();
    for (const text of ["SOMETHING_NEW", "generic", "Meta said: (#100) Invalid parameter"]) {
      fetchMock.mockImplementation(async () => conflict(text));
      const result = await createTemplateAction({ draft, idempotencyKey: KEY });
      expect(result, text).toEqual({
        status: "error",
        message: ar.whatsappTemplates.errors.generic,
      });
      expect(JSON.stringify(result)).not.toMatch(/Invalid parameter/);
    }
    for (const code of [
      "META_131056",
      "META_ERROR",
      "TEMPLATE_ALREADY_EXISTS",
      "WHATSAPP_NOT_CONFIGURED",
      "WHATSAPP_NOT_CONNECTED",
      "CONNECTION_CHANGED",
      "AUTHORIZATION_EXPIRED",
      "CREDENTIALS_UNAVAILABLE",
    ]) {
      fetchMock.mockImplementation(async () => conflict(code));
      expect((await createTemplateAction({ draft, idempotencyKey: KEY })).status, code).toBe(
        "refused",
      );
    }
    fetchMock.mockImplementation(async () =>
      json(409, { code: "CONCURRENCY", message: "version conflict", retryable: false, fields: [] }),
    );
    expect((await createTemplateAction({ draft, idempotencyKey: KEY })).status).toBe("refused");
  });
});

describe("createTemplateAction: 422 issue codes become field copy", () => {
  it.each([
    ["en", en],
    ["ar", ar],
  ] as const)("maps every issue code to its field message in %s", async (locale, t: Dictionary) => {
    expect.hasAssertions();
    state.locale = locale;
    const codes = Object.keys(t.whatsappTemplates.issues).filter((c) => c !== "unknown");
    expect(codes.length).toBeGreaterThanOrEqual(25);
    fetchMock.mockImplementation(async () =>
      validation(codes.map((code, i) => ({ field: `f${i}`, message: code }))),
    );
    const result = await createTemplateAction({ draft, idempotencyKey: KEY });
    expect(result).toEqual({
      status: "invalid",
      message: t.formErrors.invalid,
      fieldErrors: Object.fromEntries(
        codes.map((code, i) => [
          `f${i}`,
          (t.whatsappTemplates.issues as Record<string, string>)[code],
        ]),
      ),
    });
  });

  it("an unknown issue code and provider prose give the generic field copy, never the text", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      validation([
        { field: "name", message: "Meta rejected: (#100) bad token EAAB123" },
        { field: "language", message: "brand_new_code" },
      ]),
    );
    const result = await createTemplateAction({ draft, idempotencyKey: KEY });
    expect(result).toEqual({
      status: "invalid",
      message: ar.formErrors.invalid,
      fieldErrors: {
        name: ar.whatsappTemplates.issues.unknown,
        language: ar.whatsappTemplates.issues.unknown,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/EAAB123|brand_new_code|Meta rejected/);
  });

  it("keeps the first message per field and ignores an issue without a field", async () => {
    expect.hasAssertions();
    fetchMock.mockImplementation(async () =>
      validation([
        { field: "body.examples", message: "examples_mismatch" },
        { field: "body.examples", message: "example_empty" },
        { field: "", message: "name_format" },
      ]),
    );
    const result = await createTemplateAction({ draft, idempotencyKey: KEY });
    expect(result).toEqual({
      status: "invalid",
      message: ar.formErrors.invalid,
      fieldErrors: { "body.examples": ar.whatsappTemplates.issues.examples_mismatch },
    });
  });

  it("a network failure or 5xx leaves the submission unresolved (status error)", async () => {
    expect.hasAssertions();
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    expect(await createTemplateAction({ draft, idempotencyKey: KEY })).toEqual({
      status: "error",
      message: ar.whatsappTemplates.errors.generic,
    });
    fetchMock.mockReset().mockImplementation(async () => json(502, {}));
    expect(await createTemplateAction({ draft, idempotencyKey: KEY })).toEqual({
      status: "error",
      message: ar.whatsappTemplates.errors.generic,
    });
  });
});
