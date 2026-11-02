import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessReader, fetchAccessFromRuntime, fetchPreviewValidity } from "./access-cache";

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

  it("is valid only for a 200 whose body says it is a preview", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { mode: "preview" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPreviewValidity("https://rt.test")("shop-a", TOKEN)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://rt.test/api/v1/public/online-store");
    expect(init?.headers).toEqual({ "x-tenant-id": "shop-a", "x-preview-token": TOKEN });
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a proxy that drops the preview header gets the live 200, which is NOT a preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { mode: "live", locked: true })),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toBe(false);
  });

  it("is invalid for every other answer, a throw, or a timeout (fail closed)", async () => {
    for (const response of [
      json(401, { code: "PREVIEW_INVALID" }),
      json(429, { mode: "preview" }),
      json(503, {}),
      json(200, null),
      new Response("garbage", { status: 200 }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toBe(false);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await fetchPreviewValidity("https://rt.test")("s", TOKEN)).toBe(false);
    vi.stubGlobal("fetch", hangingFetch);
    expect(await fetchPreviewValidity("https://rt.test", 20)("s", TOKEN)).toBe(false);
  });
});
