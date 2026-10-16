import { describe, expect, it } from "vitest";
import { completeReset, requestReset } from "./password-reset";

const reply = (status: number, body: unknown = {}): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

const boom = (() => Promise.reject(new Error("network down"))) as typeof fetch;

const requestBase = { runtimeUrl: "https://api.test", tenantId: "tenant-local", email: "o@x.test" };
const completeBase = {
  runtimeUrl: "https://api.test",
  tenantId: "tenant-local",
  token: "fake-token-value",
  password: "fake-password-1",
};

describe("requestReset", () => {
  it("posts the email to the request route with the tenant header", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen = { url, init };
      return Promise.resolve(new Response("{}", { status: 202 }));
    }) as typeof fetch;
    expect(await requestReset({ ...requestBase, fetchImpl })).toBe("sent");
    expect(seen?.url).toBe("https://api.test/api/v1/public/auth/staff/password-reset/request");
    expect(seen?.init?.method).toBe("POST");
    expect((seen?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe("tenant-local");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ email: "o@x.test" });
  });

  it.each([
    [202, "sent"],
    [429, "limited"],
    [400, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps %s to %s", async (status, outcome) => {
    expect(await requestReset({ ...requestBase, fetchImpl: reply(status) })).toBe(outcome);
  });

  it("maps a thrown network error to unavailable", async () => {
    expect(await requestReset({ ...requestBase, fetchImpl: boom })).toBe("unavailable");
  });
});

describe("completeReset", () => {
  it("posts the token and password to the complete route with the tenant header", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen = { url, init };
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    expect(await completeReset({ ...completeBase, fetchImpl })).toBe("done");
    expect(seen?.url).toBe("https://api.test/api/v1/public/auth/staff/password-reset/complete");
    expect((seen?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe("tenant-local");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({
      token: "fake-token-value",
      password: "fake-password-1",
    });
  });

  it.each([
    [200, "done"],
    [400, "invalid"],
    [422, "weak"],
    [429, "limited"],
    [401, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps %s to %s", async (status, outcome) => {
    expect(await completeReset({ ...completeBase, fetchImpl: reply(status) })).toBe(outcome);
  });

  it("maps a thrown network error to unavailable", async () => {
    expect(await completeReset({ ...completeBase, fetchImpl: boom })).toBe("unavailable");
  });
});
