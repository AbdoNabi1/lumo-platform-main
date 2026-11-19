import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateStorefront } from "./storefront-revalidate";

const SECRET = "r".repeat(40);

beforeEach(() => {
  vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", SECRET);
  vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Every argument any console call received, flattened to text, to prove the secret never leaks. */
function loggedText(): string {
  const calls = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls];
  return JSON.stringify(calls);
}

describe("revalidateStorefront (Decision 33)", () => {
  it("posts { shopId } with the secret to the internal URL when set, else STOREFRONT_URL", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await revalidateStorefront()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("https://shop.example/api/revalidate");
    expect(init.headers["x-revalidate-secret"]).toBe(SECRET);
    expect(JSON.parse(String(init.body))).toEqual({ shopId: "shop-a" });
    vi.stubEnv("STOREFRONT_INTERNAL_URL", "http://storefront:3000");
    await revalidateStorefront();
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      "http://storefront:3000/api/revalidate",
    );
  });

  it("never throws: network errors, timeouts and missing config are false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await revalidateStorefront()).toBe(false);
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "");
    expect(await revalidateStorefront()).toBe(false);
  });

  it("logs a missing secret (Ruling 21) and never calls the storefront, even in production", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "");
    expect(await revalidateStorefront("shop-a")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggedText()).toContain("STOREFRONT_REVALIDATE_SECRET");
  });

  it("treats a 400 as a configuration bug: logged as an error, with the shop id and never the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({ code: "INVALID_SHOP" }, { status: 400 }),
      ),
    );
    expect(await revalidateStorefront("bad shop")).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain("bad shop");
    expect(loggedText()).not.toContain(SECRET);
  });

  it("a refused secret (401) is false and logged without the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 401 })),
    );
    expect(await revalidateStorefront()).toBe(false);
    expect(loggedText()).toContain("401");
    expect(loggedText()).not.toContain(SECRET);
  });

  it("gives up after 2 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const pending = revalidateStorefront();
    await vi.advanceTimersByTimeAsync(1_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(false);
  });

  it("never follows a redirect (the secret header must not travel to another origin)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await revalidateStorefront();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe("error");
  });

  it("a refused redirect is logged as a configuration problem, with its cause and never the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      }),
    );
    expect(await revalidateStorefront()).toBe(false);
    expect(loggedText()).toContain("unexpected redirect");
    expect(loggedText()).not.toContain(SECRET);
  });

  it("releases the connection: an unread answer body is cancelled", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => new Response(body, { status: 200 })),
    );
    expect(await revalidateStorefront()).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("names the missing tenant variable when the shop id cannot be resolved in production", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("TENANT_DEFAULT_ID", "");
    expect(await revalidateStorefront()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggedText()).toContain("TENANT_DEFAULT_ID");
  });
});
