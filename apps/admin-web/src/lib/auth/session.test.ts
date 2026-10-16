import { afterEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

function cookieJar(value: string | undefined) {
  return { get: () => (value === undefined ? undefined : { value }) };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("readSession", () => {
  it("resolves null when there is no session cookie", async () => {
    cookiesMock.mockResolvedValue(cookieJar(undefined));
    const { readSession } = await import("./session");

    expect(await readSession()).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("resolves null when cookies() throws (no request scope, e.g. build time)", async () => {
    cookiesMock.mockRejectedValue(new Error("outside request scope"));
    const { readSession } = await import("./session");

    expect(await readSession()).toBeNull();
  });

  it("resolves null when the token fails verification (expired, wrong issuer, tampered)", async () => {
    cookiesMock.mockResolvedValue(cookieJar("bad.token.here"));
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    const { readSession } = await import("./session");

    expect(await readSession()).toBeNull();
  });

  it("resolves the principal from a valid token's claims", async () => {
    cookiesMock.mockResolvedValue(cookieJar("good.token.here"));
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "identity-1", kind: "staff", roles: ["admin", "orders:read"] },
    });
    const { readSession } = await import("./session");

    expect(await readSession()).toEqual({
      token: "good.token.here",
      principalId: "identity-1",
      kind: "staff",
      roles: ["admin", "orders:read"],
    });
  });

  it("defaults kind to customer and roles to empty when claims omit them", async () => {
    cookiesMock.mockResolvedValue(cookieJar("good.token.here"));
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "identity-2" } });
    const { readSession } = await import("./session");

    expect(await readSession()).toEqual({
      token: "good.token.here",
      principalId: "identity-2",
      kind: "customer",
      roles: [],
    });
  });

  it("resolves null when the token verifies but has no subject", async () => {
    cookiesMock.mockResolvedValue(cookieJar("good.token.here"));
    jwtVerifyMock.mockResolvedValue({ payload: {} });
    const { readSession } = await import("./session");

    expect(await readSession()).toBeNull();
  });

  it("resolves email from the token's claims when present (Phase A.34)", async () => {
    cookiesMock.mockResolvedValue(cookieJar("good.token.here"));
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "identity-1", kind: "staff", roles: ["admin"], email: "admin@morbeh.local" },
    });
    const { readSession } = await import("./session");

    const session = await readSession();
    expect(session?.email).toBe("admin@morbeh.local");
  });

  it("leaves email undefined when the token has no email claim — never invents one", async () => {
    cookiesMock.mockResolvedValue(cookieJar("good.token.here"));
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "identity-1" } });
    const { readSession } = await import("./session");

    const session = await readSession();
    expect(session?.email).toBeUndefined();
  });
});

describe("highestRole", () => {
  it("returns undefined when no role in the list is recognized", async () => {
    const { highestRole } = await import("./session");
    expect(highestRole([])).toBeUndefined();
    expect(highestRole(["orders:read", "customers:read"])).toBeUndefined();
  });

  it("returns the single recognized role", async () => {
    const { highestRole } = await import("./session");
    expect(highestRole(["viewer"])).toBe("viewer");
  });

  it("returns the highest-ranked role when multiple are present", async () => {
    const { highestRole } = await import("./session");
    expect(highestRole(["viewer", "operator"])).toBe("operator");
    expect(highestRole(["viewer", "operator", "admin"])).toBe("admin");
    expect(highestRole(["admin", "orders:read"])).toBe("admin");
  });
});
