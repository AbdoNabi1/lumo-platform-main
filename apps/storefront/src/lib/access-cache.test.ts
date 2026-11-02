import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccessReader,
  createPreviewChecker,
  fetchAccessFromRuntime,
  fetchPreviewValidity,
  previewCacheKey,
  type PreviewCheck,
} from "./access-cache";

const locked = { locked: true, accessVersion: 2 };

afterEach(() => vi.unstubAllGlobals());

describe("createAccessReader (spec 1.12, Review Focus 3)", () => {
  it("caches for 15 s, then asks again", async () => {
    let t = 0;
    const fetchAccess = vi.fn(async () => locked);
    const read = createAccessReader({ fetchAccess, now: () => t, ttlMs: 15_000, staleMs: 300_000 });
    await read("s");
    t = 14_999;
    await read("s");
    expect(fetchAccess).toHaveBeenCalledTimes(1);
    t = 15_000;
    await read("s");
    expect(fetchAccess).toHaveBeenCalledTimes(2);
  });

  it("serves the last known value for up to 5 minutes while the Runtime fails, then throws", async () => {
    let t = 0;
    const fetchAccess = vi
      .fn<(shopId: string) => Promise<typeof locked>>()
      .mockResolvedValueOnce(locked)
      .mockRejectedValue(new Error("down"));
    const read = createAccessReader({ fetchAccess, now: () => t, ttlMs: 15_000, staleMs: 300_000 });
    await read("s");
    t = 299_000;
    expect(await read("s")).toEqual(locked);
    t = 300_001;
    await expect(read("s")).rejects.toThrow();
  });

  it("never caches a failure, and never shares an entry between shops", async () => {
    const fetchAccess = vi
      .fn<(shopId: string) => Promise<typeof locked>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(async (shop) => ({ locked: shop === "a", accessVersion: 1 }));
    const read = createAccessReader({ fetchAccess, now: () => 0, ttlMs: 15_000, staleMs: 300_000 });
    await expect(read("a")).rejects.toThrow();
    expect(await read("a")).toEqual({ locked: true, accessVersion: 1 });
    expect(await read("b")).toEqual({ locked: false, accessVersion: 1 });
  });

  it("keeps at most maxEntries shops, dropping the least recently stored", async () => {
    const fetchAccess = vi.fn(async () => locked);
    const read = createAccessReader({
      fetchAccess,
      now: () => 0,
      ttlMs: 15_000,
      staleMs: 300_000,
      maxEntries: 2,
    });
    await read("a");
    await read("b");
    await read("c"); // evicts a
    expect(fetchAccess).toHaveBeenCalledTimes(3);
    await read("b");
    await read("c");
    expect(fetchAccess).toHaveBeenCalledTimes(3);
    await read("a");
    expect(fetchAccess).toHaveBeenCalledTimes(4);
  });
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that never answers, but honours its abort signal like the real one. */
const hangingFetch = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }),
);

describe("fetchAccessFromRuntime", () => {
  it("reads the shop's lock state with its tenant header, uncached, under a timeout", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { locked: true, accessVersion: 7, message: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAccessFromRuntime("https://rt.test")("shop-a")).toEqual({
      locked: true,
      accessVersion: 7,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://rt.test/api/v1/public/online-store/access");
    expect(init?.headers).toEqual({ "x-tenant-id": "shop-a" });
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx answer or a body of the wrong shape (never guesses 'unlocked')", async () => {
    for (const response of [
      json(503, {}),
      json(200, { locked: "no", accessVersion: 1 }),
      json(200, { locked: false }),
      json(200, { locked: false, accessVersion: 1.5 }),
      json(200, { locked: false, accessVersion: -1 }),
      new Response("not json", { status: 200 }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(fetchAccessFromRuntime("https://rt.test")("s")).rejects.toThrow();
    }
  });

  it("gives up on a hung Runtime after its timeout (Ruling 2), so the stale value or a 503 follows", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    await expect(fetchAccessFromRuntime("https://rt.test", 20)("s")).rejects.toThrow();
  });
});

describe("fetchPreviewValidity (Ruling 36)", () => {
  const TOKEN = "T".repeat(43);

  it("is valid only for a 200 whose body says it is a preview, with its expiry", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { mode: "preview", previewExpiresAt: "2026-11-02T10:00:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPreviewValidity("https://rt.test")("shop-a", TOKEN)).toEqual({
      kind: "valid",
      expiresAtMs: Date.parse("2026-11-02T10:00:00.000Z"),
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://rt.test/api/v1/public/online-store");
    expect(init?.headers).toEqual({ "x-tenant-id": "shop-a", "x-preview-token": TOKEN });
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { mode: "preview", previewExpiresAt: "soon" })),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toEqual({
      kind: "valid",
      expiresAtMs: null,
    });
  });

  it("a proxy that drops the preview header gets the live 200, which is NOT a preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { mode: "live", locked: true })),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toEqual({ kind: "invalid" });
  });

  it("a 401 is a definite 'invalid'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { code: "PREVIEW_INVALID" })),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toEqual({ kind: "invalid" });
  });

  it("every other answer, a garbage body, a throw or a timeout is an error (never 'valid')", async () => {
    for (const response of [
      json(429, { mode: "preview" }),
      json(503, {}),
      json(404, {}),
      json(200, null),
      json(200, "preview"),
      new Response("garbage", { status: 200 }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toEqual({ kind: "error" });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toEqual({ kind: "error" });
    vi.stubGlobal("fetch", hangingFetch);
    expect(await fetchPreviewValidity("https://rt.test", 20)("s", TOKEN)).toEqual({
      kind: "error",
    });
  });
});

describe("previewCacheKey", () => {
  it("is the shop plus the SHA-256 of the token, never the token itself", async () => {
    const token = "T".repeat(43);
    const key = await previewCacheKey("shop-a", token);
    expect(key).not.toContain(token);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    );
    const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(key).toBe(`shop-a:${hex}`);
    expect(await previewCacheKey("shop-b", token)).not.toBe(key);
  });
});

describe("createPreviewChecker (review M-3)", () => {
  const TOKEN = "T".repeat(43);
  const setup = (answers: PreviewCheck[], maxEntries = 500) => {
    let t = 1_000_000;
    const check = vi.fn(async (_shopId: string, _token: string) => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      return next ?? { kind: "error" as const };
    });
    const isValid = createPreviewChecker({
      check,
      now: () => t,
      validTtlMs: 30_000,
      invalidTtlMs: 30_000,
      maxEntries,
    });
    return { check, isValid, at: (ms: number) => (t = 1_000_000 + ms) };
  };

  it("caches a valid answer for 30 s", async () => {
    const { check, isValid, at } = setup([{ kind: "valid", expiresAtMs: 1_000_000 + 3_600_000 }]);
    expect(await isValid("s", TOKEN)).toBe(true);
    at(29_999);
    expect(await isValid("s", TOKEN)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    at(30_000);
    await isValid("s", TOKEN);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never keeps a valid answer past the token's own expiry", async () => {
    const { check, isValid, at } = setup([
      { kind: "valid", expiresAtMs: 1_000_000 + 10_000 },
      { kind: "invalid" },
    ]);
    expect(await isValid("s", TOKEN)).toBe(true);
    at(9_999);
    expect(await isValid("s", TOKEN)).toBe(true);
    at(10_000);
    expect(await isValid("s", TOKEN)).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not cache a valid answer whose expiry is unknown or already past", async () => {
    for (const expiresAtMs of [null, 1_000_000, 999_000]) {
      const { check, isValid } = setup([{ kind: "valid", expiresAtMs }]);
      expect(await isValid("s", TOKEN)).toBe(true);
      expect(await isValid("s", TOKEN)).toBe(true);
      expect(check).toHaveBeenCalledTimes(2);
    }
  });

  it("caches an invalid answer for 30 s", async () => {
    const { check, isValid, at } = setup([{ kind: "invalid" }]);
    expect(await isValid("s", TOKEN)).toBe(false);
    at(29_999);
    expect(await isValid("s", TOKEN)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    at(30_000);
    await isValid("s", TOKEN);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never caches an error or timeout (fails closed now, asks again next time)", async () => {
    const { check, isValid } = setup([
      { kind: "error" },
      { kind: "valid", expiresAtMs: 1_000_000 + 3_600_000 },
    ]);
    expect(await isValid("s", TOKEN)).toBe(false);
    expect(await isValid("s", TOKEN)).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never shares an answer between shops or tokens", async () => {
    const { check, isValid } = setup([{ kind: "valid", expiresAtMs: 1_000_000 + 3_600_000 }]);
    await isValid("shop-a", TOKEN);
    await isValid("shop-b", TOKEN);
    await isValid("shop-a", "U".repeat(43));
    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls.map(([shop]) => shop)).toEqual(["shop-a", "shop-b", "shop-a"]);
  });

  it("keeps at most maxEntries answers, dropping the least recently used", async () => {
    const { check, isValid } = setup([{ kind: "invalid" }], 2);
    await isValid("s", "a".repeat(32));
    await isValid("s", "b".repeat(32));
    await isValid("s", "a".repeat(32)); // a is now the most recent
    await isValid("s", "c".repeat(32)); // evicts b
    expect(check).toHaveBeenCalledTimes(3);
    await isValid("s", "a".repeat(32));
    await isValid("s", "c".repeat(32));
    expect(check).toHaveBeenCalledTimes(3);
    await isValid("s", "b".repeat(32));
    expect(check).toHaveBeenCalledTimes(4);
  });
});
