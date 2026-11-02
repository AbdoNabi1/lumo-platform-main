import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setCookie = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
/** The shop the middleware resolved for this request (`x-shop-id`), when host routing is on. */
const resolvedShop = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie }),
  headers: async () => ({ get: (name: string) => (name === "x-shop-id" ? resolvedShop.id : null) }),
}));
vi.mock("next/navigation", () => ({ redirect }));
const { unlockAction } = await import("./actions");
const { verifyAccessCookie } = await import("@/lib/access-cookie");

const form = (password: string, returnTo = "/products/lamp") => {
  const f = new FormData();
  f.set("password", password);
  f.set("return_to", returnTo);
  return f;
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "off");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", "a".repeat(32));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setCookie.mockReset();
  redirect.mockClear();
});

describe("unlockAction", () => {
  it("sets the HttpOnly host-only cookie and redirects to a safe return_to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { accessVersion: 4 })),
    );
    await expect(
      unlockAction({ status: "idle" }, form("open sesame", "//evil.example")),
    ).rejects.toThrow("REDIRECT:/");
    const [name, value, options] = setCookie.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("morbeh-storefront-access");
    expect(value).toMatch(/^v1\.4\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain("sesame");
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  });

  it("signs with the shop and the version from the unlock answer itself, never a re-read (Ruling 3)", async () => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    resolvedShop.id = "shop-a";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { accessVersion: 9 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(unlockAction({ status: "idle" }, form("open sesame", "/cart"))).rejects.toThrow(
      "REDIRECT:/cart",
    );
    resolvedShop.id = null;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/v1\/public\/online-store\/unlock$/);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-tenant-id": "shop-a" });
    expect(JSON.parse(String(init?.body))).toEqual({ password: "open sesame" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const value = setCookie.mock.calls[0]?.[1] as string;
    const nowUnix = Math.floor(Date.now() / 1000);
    const check = { secret: "a".repeat(32), shopId: "shop-a", nowUnix };
    expect(await verifyAccessCookie(value, { ...check, accessVersion: 9 })).toBe(true);
    expect(await verifyAccessCookie(value, { ...check, accessVersion: 8 })).toBe(false);
    expect(await verifyAccessCookie(value, { ...check, shopId: "shop-b", accessVersion: 9 })).toBe(
      false,
    );
  });

  it("an open-redirect return_to lands on the shop's home", async () => {
    for (const raw of ["/\t/evil.example", "https://evil.example", "/\\evil.example"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json(200, { accessVersion: 1 })),
      );
      await expect(unlockAction({ status: "idle" }, form("pw", raw))).rejects.toThrow(
        /^REDIRECT:\/$/,
      );
    }
  });

  it("maps 401 → incorrect and 429 → minutes to wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { code: "PASSWORD_INCORRECT" })),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "incorrect" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(429, { code: "RATE_LIMITED", retryAfterMs: 90_000 }, { "retry-after": "90" }),
      ),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({
      status: "rate_limited",
      minutes: 2,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(429, {}, { "retry-after": "300" })),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({
      status: "rate_limited",
      minutes: 5,
    });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("treats every other answer, a bad body, a throw or a timeout as unavailable (Ruling 5)", async () => {
    for (const make of [
      () => json(403, { code: "FORBIDDEN" }),
      () => json(404, {}),
      () => json(500, {}),
      () => json(503, {}),
      () => json(201, { accessVersion: 1 }),
      () => json(200, {}),
      () => json(200, { accessVersion: "4" }),
      () => json(200, { accessVersion: -1 }),
      () => json(200, { accessVersion: 1.5 }),
      () => new Response("not json", { status: 200 }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => make()),
      );
      expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "unavailable" });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "unavailable" });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("a blank or oversized password never spends a shop-wide attempt (Ruling 4)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const password of ["", "   ", "\t\n ", "x".repeat(201)]) {
      expect(await unlockAction({ status: "idle" }, form(password))).toEqual({
        status: "incorrect",
      });
    }
    const missing = new FormData();
    expect(await unlockAction({ status: "idle" }, missing)).toEqual({ status: "incorrect" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without a signing secret says temporarily unavailable and never calls the Runtime", async () => {
    vi.stubEnv("STOREFRONT_ACCESS_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
