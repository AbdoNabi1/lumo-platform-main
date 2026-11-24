import { describe, expect, it, vi } from "vitest";
import { acceptInvitation } from "./invitation";

function reply(status: number): typeof fetch {
  return vi.fn().mockResolvedValue(new Response("{}", { status })) as unknown as typeof fetch;
}

const BASE = {
  runtimeUrl: "http://runtime.test",
  tenantId: "platform",
  token: "tok-1",
  password: "correct horse 1",
};

describe("acceptInvitation", () => {
  it("uses the merchant route, with the store in the body, when the link names a store", async () => {
    expect.hasAssertions();
    const fetchImpl = reply(200);
    expect(await acceptInvitation({ ...BASE, store: "acme", fetchImpl })).toBe("done");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/public/auth/merchant/invitations/accept");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      store: "acme",
      token: "tok-1",
      password: "correct horse 1",
    });
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe("platform");
  });

  it("uses the staff route, with no store, when the link names none", async () => {
    expect.hasAssertions();
    const fetchImpl = reply(200);
    expect(await acceptInvitation({ ...BASE, fetchImpl })).toBe("done");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/public/auth/staff/invitations/accept");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-1", password: "correct horse 1" });
    expect(String(url)).not.toContain("tok-1");
    expect(String(url)).not.toContain("correct horse");
  });

  it("an empty store means the staff route", async () => {
    expect.hasAssertions();
    const fetchImpl = reply(200);
    await acceptInvitation({ ...BASE, store: "", fetchImpl });
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toContain("/staff/invitations/accept");
  });

  it.each([
    [200, "done"],
    [410, "invalid"],
    [422, "weak"],
    [429, "limited"],
    [403, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps %i to %s", async (status, expected) => {
    expect.hasAssertions();
    expect(await acceptInvitation({ ...BASE, store: "acme", fetchImpl: reply(status) })).toBe(
      expected,
    );
  });

  it("a network failure is unavailable, never a throw", async () => {
    expect.hasAssertions();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch;
    expect(await acceptInvitation({ ...BASE, fetchImpl })).toBe("unavailable");
  });
});
