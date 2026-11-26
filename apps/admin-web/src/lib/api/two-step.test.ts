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
  confirmOwnTwoStep,
  disableOwnTwoStep,
  fetchOwnTwoStep,
  regenerateBackupCodes,
  startOwnTwoStep,
} = await import("./two-step");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

const STATUS = {
  enabled: true,
  activatedAt: "2026-11-20T10:00:00.000Z",
  backupCodesLeft: 9,
  policyRequired: false,
};
const SETUP = {
  enrollmentId: "5b8d3f1e-0000-4000-8000-000000000001",
  manualKey: "JBSWY3DPEHPK3PXP",
  provisioningUri: "otpauth://totp/Morbeh:me%40shop.example?secret=JBSWY3DPEHPK3PXP",
};

beforeEach(() => {
  expect.hasAssertions();
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchOwnTwoStep", () => {
  it("GETs /auth/staff/two-step and validates the exact status shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, STATUS));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOwnTwoStep()).toEqual({ outcome: "ok", data: STATUS });
    expect(lastCall(fetchMock)[0]).toBe("http://runtime.test/api/v1/auth/staff/two-step");
  });

  it.each([
    ["a missing field", { enabled: true, activatedAt: null, backupCodesLeft: 0 }],
    ["a string count", { ...STATUS, backupCodesLeft: "9" }],
    ["a non-boolean flag", { ...STATUS, policyRequired: "no" }],
    ["a non-boolean platformRequired", { ...STATUS, platformRequired: "yes" }],
  ])("rejects %s as an unexpected shape", async (_name, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));
    expect((await fetchOwnTwoStep()).outcome).toBe("error");
  });
});

describe("fetchOwnTwoStep — platformRequired (Wave 1f)", () => {
  it("carries platformRequired through and accepts a server that does not send it yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...STATUS, platformRequired: true })),
    );
    expect(await fetchOwnTwoStep()).toEqual({
      outcome: "ok",
      data: { ...STATUS, platformRequired: true },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, STATUS)));
    expect((await fetchOwnTwoStep()).outcome).toBe("ok");
  });

  it("disable while the platform requires it is a flat 409 TWO_STEP_REQUIRED (read as body.code)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: "TWO_STEP_REQUIRED",
          message: "Two-step verification is required for everyone, so it can't be turned off",
        }),
      ),
    );
    expect(await disableOwnTwoStep("pw")).toMatchObject({
      outcome: "conflict",
      code: "TWO_STEP_REQUIRED",
    });
  });
});

describe("the writes (no idempotency key, ever)", () => {
  it("start: POST {} → the setup, validated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, SETUP));
    vi.stubGlobal("fetch", fetchMock);
    expect(await startOwnTwoStep()).toEqual({ outcome: "ok", data: SETUP });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/auth/staff/two-step/start");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("idempotency-key");
  });

  it("start: a provisioning link that is not otpauth:// is a contract break", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(201, { ...SETUP, provisioningUri: "https://evil.example" }),
        ),
    );
    expect((await startOwnTwoStep()).outcome).toBe("error");
  });

  it("start: the flat 503 NOT_CONFIGURED and the nested one both carry the code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { code: "NOT_CONFIGURED", message: "m" })),
    );
    expect(await startOwnTwoStep()).toMatchObject({
      outcome: "error",
      status: 503,
      code: "NOT_CONFIGURED",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(503, { error: { code: "NOT_CONFIGURED", message: "m" } })),
    );
    expect(await startOwnTwoStep()).toMatchObject({
      outcome: "error",
      status: 503,
      code: "NOT_CONFIGURED",
    });
  });

  it("confirm: POST { enrollmentId, code } → the backup codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { backupCodes: ["a", "b"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await confirmOwnTwoStep({ enrollmentId: SETUP.enrollmentId, code: "123456" })).toEqual({
      outcome: "ok",
      data: { backupCodes: ["a", "b"] },
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/auth/staff/two-step/confirm");
    expect(JSON.parse(String(init.body))).toEqual({
      enrollmentId: SETUP.enrollmentId,
      code: "123456",
    });
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("idempotency-key");
  });

  it("confirm: a 409 carries the message, a 429 the status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: "BUSINESS_RULE",
          message: "That code didn't work. Try again.",
        }),
      ),
    );
    expect(await confirmOwnTwoStep({ enrollmentId: "e", code: "1" })).toMatchObject({
      outcome: "conflict",
      message: "That code didn't work. Try again.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(429, { code: "RATE_LIMITED", message: "m" })),
    );
    expect(await confirmOwnTwoStep({ enrollmentId: "e", code: "1" })).toMatchObject({
      outcome: "error",
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("backup codes: POST { code } → new codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { backupCodes: ["x"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await regenerateBackupCodes("123456")).toEqual({
      outcome: "ok",
      data: { backupCodes: ["x"] },
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/auth/staff/two-step/backup-codes");
    expect(JSON.parse(String(init.body))).toEqual({ code: "123456" });
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("idempotency-key");
  });

  it("disable: POST { password }; a wrong password is a 401 that still carries INVALID_PASSWORD", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { code: "INVALID_PASSWORD", message: "m" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await disableOwnTwoStep("nope")).toEqual({
      outcome: "unauthorized",
      code: "INVALID_PASSWORD",
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/auth/staff/two-step/disable");
    expect(JSON.parse(String(init.body))).toEqual({ password: "nope" });
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("idempotency-key");
  });

  it("disable: success, and the policy 409", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { outcome: "disabled" })));
    expect((await disableOwnTwoStep("pw")).outcome).toBe("ok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          message: "Your store requires two-step verification, so it can't be turned off",
        }),
      ),
    );
    expect(await disableOwnTwoStep("pw")).toMatchObject({ outcome: "conflict" });
  });
});
