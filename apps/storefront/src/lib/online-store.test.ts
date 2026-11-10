import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

const cacheCalls: { keyParts: string[]; tags: string[]; revalidate: number }[] = [];
/** What the real unstable_cache would do with each run: store the value, or store nothing. */
const cacheOutcomes: ("stored" | "threw")[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    opts: { tags: string[]; revalidate: number },
  ) => {
    cacheCalls.push({ keyParts, tags: opts.tags, revalidate: opts.revalidate });
    return async () => {
      try {
        const value = await fn();
        cacheOutcomes.push("stored");
        return value;
      } catch (error) {
        cacheOutcomes.push("threw");
        throw error;
      }
    };
  },
}));
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => requestHeaders.get(k) ?? null }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));

const { FALLBACK_SHELL, getPublicAccess, getStorefrontShell, parseShell, sanitizeShell, shellTag } =
  await import("./online-store");

const liveBody = {
  mode: "live",
  previewExpiresAt: null,
  branded: true,
  storeName: "Nour",
  defaultLocale: "en",
  preferences: { homeTitle: { en: "Nour" }, homeMetaDescription: {}, shareImage: null },
  brand: {
    logo: {
      image: { url: "https://cdn.test/l.png", alt: null, width: 400, height: 100 },
      widthPx: 160,
    },
    favicon: null,
    colors: {
      background: "#ffffff",
      foreground: "#111111",
      primary: "#0055ff",
      primaryForeground: "#ffffff",
      accent: "#ffcc00",
      accentForeground: "#000000",
    },
    typography: { headingFont: "cairo", bodyFont: "tajawal", baseSize: "large" },
    corners: "pill",
    social: { instagram: "https://instagram.com/nour" },
  },
  header: { sticky: true },
  footer: { note: { ar: "أهلاً" }, showSocial: true },
  locked: false,
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Init = RequestInit & { headers: Record<string, string> };

beforeEach(() => {
  cacheCalls.length = 0;
  cacheOutcomes.length = 0;
  requestHeaders.clear();
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getStorefrontShell", () => {
  it("two shops, two cache entries: the shop id is in the key parts and the tag (Review Focus 2)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, liveBody));
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    await getStorefrontShell(null);
    requestHeaders.set("x-shop-id", "shop-b");
    await getStorefrontShell(null);
    expect(cacheCalls).toEqual([
      { keyParts: ["online-store", "shop-a", "shell"], tags: ["os:shop-a"], revalidate: 60 },
      { keyParts: ["online-store", "shop-b", "shell"], tags: ["os:shop-b"], revalidate: 60 },
    ]);
    const tenants = fetchMock.mock.calls.map((c) => (c[1] as Init).headers["x-tenant-id"]);
    expect(tenants).toEqual(["shop-a", "shop-b"]);
    expect(shellTag("shop-a")).toBe("os:shop-a");
  });

  it("previews are never cached and send x-preview-token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { ...liveBody, mode: "preview", previewExpiresAt: "2026-10-27T11:00:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("tok");
    expect(shell.mode).toBe("preview");
    expect(shell.previewExpiresAt).toBe("2026-10-27T11:00:00.000Z");
    expect(cacheCalls).toEqual([]);
    const init = fetchMock.mock.calls[0]?.[1] as Init;
    expect(init.headers["x-preview-token"]).toBe("tok");
    expect(init.cache).toBe("no-store");
  });

  it("an expired preview shows the live shell with previewExpired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        (init.headers as Record<string, string>)["x-preview-token"] === undefined
          ? json(200, liveBody)
          : json(401, { code: "PREVIEW_INVALID" }),
      ),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("old");
    expect(shell).toMatchObject({ mode: "live", previewExpired: true, storeName: "Nour" });
  });

  it("a failing Runtime gives the fallback (never thrown, never cached)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => json(503, {})),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getStorefrontShell(null)).toEqual(FALLBACK_SHELL);
    expect(cacheOutcomes).toEqual(["threw"]);
    expect(FALLBACK_SHELL).toMatchObject({
      branded: false,
      locked: false,
      defaultLocale: "ar",
      storeName: "",
    });
  });

  it("every Runtime read carries a timeout signal", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      json(200, {
        ...liveBody,
        mode:
          (init.headers as Record<string, string>)["x-preview-token"] === undefined
            ? "live"
            : "preview",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    await getStorefrontShell(null);
    await getStorefrontShell("tok");
    expect(fetchMock.mock.calls).toHaveLength(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as Init).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("a hung Runtime falls back instead of hanging the layout (live, preview and access)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    const hung = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (signal === undefined || signal === null) return;
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    vi.stubGlobal("fetch", hung);
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getStorefrontShell(null)).toEqual(FALLBACK_SHELL);
    expect(await getStorefrontShell("tok")).toEqual(FALLBACK_SHELL);
    expect(await getPublicAccess()).toBeNull();
    expect(timeout).toHaveBeenCalledWith(3000);
    // The live read, then the preview read that timed out and fell through to a live read again.
    expect(cacheOutcomes).toEqual(["threw", "threw"]);
  });

  it("a garbage or empty 200 is the fallback and is never stored in the cache (I1)", async () => {
    requestHeaders.set("x-shop-id", "shop-a");
    for (const body of [{}, "garbage", [], { mode: "live" }, { mode: "live", brand: {} }]) {
      cacheOutcomes.length = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, _init: RequestInit) => json(200, body)),
      );
      expect(await getStorefrontShell(null)).toEqual(FALLBACK_SHELL);
      expect(cacheOutcomes).toEqual(["threw"]);
    }
  });

  it("a live read answered with another mode is unusable and not stored (I2)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        json(200, { ...liveBody, mode: "preview", previewExpiresAt: "2026-10-27T11:00:00.000Z" }),
      ),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getStorefrontShell(null)).toEqual(FALLBACK_SHELL);
    expect(cacheOutcomes).toEqual(["threw"]);
  });

  it("a token read answered as live is never treated as a preview (I2)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(200, liveBody));
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("tok");
    expect(shell).toMatchObject({
      mode: "live",
      previewExpired: false,
      previewExpiresAt: null,
      storeName: "Nour",
    });
    // The token read was refused as unusable, then the live shell was read through the cache.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1] as Init).headers["x-preview-token"]).toBe("tok");
    expect((fetchMock.mock.calls[1]?.[1] as Init).headers["x-preview-token"]).toBeUndefined();
    expect(cacheOutcomes).toEqual(["stored"]);
  });

  it("a preview read that fails other than with 401 shows the live shell, not previewExpired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if ((init.headers as Record<string, string>)["x-preview-token"] !== undefined) {
          throw new DOMException("timed out", "TimeoutError");
        }
        return json(200, liveBody);
      }),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("tok");
    expect(shell).toMatchObject({ mode: "live", previewExpired: false, storeName: "Nour" });
  });
});

describe("getPublicAccess", () => {
  it("reads the access state uncached and with the shop id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, { locked: true, accessVersion: 3, message: { ar: "قريباً" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getPublicAccess()).toEqual({
      locked: true,
      accessVersion: 3,
      message: { ar: "قريباً" },
    });
    const init = fetchMock.mock.calls[0]?.[1] as Init;
    expect(init.headers["x-tenant-id"]).toBe("shop-a");
    expect(init.cache).toBe("no-store");
    expect(cacheCalls).toEqual([]);
  });

  it("only accepts a whole, non-negative access version", async () => {
    requestHeaders.set("x-shop-id", "shop-a");
    const answer = (accessVersion: unknown) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, _init: RequestInit) =>
          json(200, { locked: true, accessVersion, message: {} }),
        ),
      );
      return getPublicAccess();
    };
    expect(await answer(0)).toMatchObject({ accessVersion: 0 });
    for (const bad of [1.5, -1, null, "2"]) expect(await answer(bad)).toBeNull();
  });

  it("clips the visitor message to the 500 characters the admin allows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        json(200, { locked: true, accessVersion: 1, message: { ar: "م".repeat(900) } }),
      ),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    expect((await getPublicAccess())?.message.ar).toHaveLength(500);
  });

  it("is null when the Runtime answers badly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) => json(200, { locked: "yes" })),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getPublicAccess()).toBeNull();
  });
});

describe("FALLBACK_SHELL", () => {
  it("is frozen all the way down, so no consumer can change it for the next request", () => {
    const frozen = (value: unknown): boolean =>
      typeof value !== "object" ||
      value === null ||
      (Object.isFrozen(value) && Object.values(value).every(frozen));
    expect(frozen(FALLBACK_SHELL)).toBe(true);
    expect(frozen(sanitizeShell("garbage", "live"))).toBe(true);
  });
});

describe("parseShell", () => {
  it("is null for an unusable body and for a body of another mode", () => {
    for (const raw of [
      undefined,
      null,
      "x",
      3,
      [],
      {},
      { mode: "live" },
      { mode: "live", brand: {} },
    ]) {
      expect(parseShell(raw, "live")).toBeNull();
    }
    expect(parseShell(liveBody, "preview")).toBeNull();
    expect(parseShell({ ...liveBody, mode: "preview" }, "live")).toBeNull();
    expect(parseShell(liveBody, "live")).toMatchObject({ mode: "live", storeName: "Nour" });
  });
});

describe("sanitizeShell (defence in depth, spec 1.12)", () => {
  it("clips merchant strings to the admin limits", () => {
    const long = (n: number) => "ب".repeat(n + 50);
    const shell = sanitizeShell(
      {
        ...liveBody,
        storeName: "n".repeat(500),
        preferences: {
          homeTitle: { ar: long(70) },
          homeMetaDescription: { en: "d".repeat(900) },
          shareImage: { url: "https://cdn.test/s.png", alt: "a".repeat(900) },
        },
        footer: { note: { ar: long(200) }, showSocial: true },
      },
      "live",
    );
    expect(shell.storeName).toHaveLength(120);
    expect(shell.preferences.homeTitle.ar).toHaveLength(70);
    expect(shell.preferences.homeMetaDescription.en).toHaveLength(320);
    expect(shell.preferences.shareImage?.alt).toHaveLength(300);
    expect(shell.footer.note.ar).toHaveLength(200);
  });

  it("keeps valid data", () => {
    const shell = sanitizeShell(liveBody, "live");
    expect(shell.brand.style.corners).toBe("pill");
    expect(shell.brand.logo).toEqual({
      image: { url: "https://cdn.test/l.png", alt: null, width: 400, height: 100 },
      widthPx: 160,
    });
    expect(shell.brand.social).toEqual({ instagram: "https://instagram.com/nour" });
  });

  it("falls back on hostile or corrupt values", () => {
    const shell = sanitizeShell(
      {
        ...liveBody,
        defaultLocale: "fr",
        brand: {
          ...liveBody.brand,
          logo: {
            image: { url: "javascript:alert(1)", alt: 3, width: -1, height: "x" },
            widthPx: 99999,
          },
          colors: { ...liveBody.brand.colors, background: "#000000;}</style><script>" },
          social: { instagram: "http://insecure.example", myspace: "https://x" },
        },
      },
      "live",
    );
    expect(shell.defaultLocale).toBe("ar");
    expect(shell.brand.logo).toEqual({ image: null, widthPx: 140 });
    expect(shell.brand.style.colors.background).toBe("#f8fafc");
    expect(shell.brand.social).toEqual({});
    expect(sanitizeShell("garbage", "live")).toEqual({ ...FALLBACK_SHELL });
  });

  it("drops http: images (mixed content), except localhost media in development", () => {
    const withLogo = (url: string) =>
      sanitizeShell(
        {
          ...liveBody,
          brand: { ...liveBody.brand, logo: { image: { url, alt: null }, widthPx: 160 } },
        },
        "live",
      ).brand.logo.image?.url ?? null;
    expect(withLogo("http://cdn.test/l.png")).toBeNull();
    expect(withLogo("http://localhost:9000/l.png")).toBeNull(); // NODE_ENV is "test" here
    vi.stubEnv("NODE_ENV", "development");
    try {
      expect(withLogo("http://localhost:9000/l.png")).toBe("http://localhost:9000/l.png");
      expect(withLogo("http://127.0.0.1:9000/l.png")).toBe("http://127.0.0.1:9000/l.png");
      expect(withLogo("http://cdn.test/l.png")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(withLogo("https://cdn.test/l.png")).toBe("https://cdn.test/l.png");
  });
});

describe("menus in the shell (spec 2.6, 2.8)", () => {
  const withMenus = (header: unknown, footer: unknown) => ({
    ...liveBody,
    header: { sticky: false, menu: header },
    footer: {
      note: {},
      showSocial: true,
      menu: footer,
      policies: ["terms", "refund", "terms", "cookies"],
    },
  });

  it("re-validates every item: unsafe hrefs and empty labels go, external is recomputed", () => {
    const shell = parseShell(
      withMenus(
        [
          { label: { en: "Home" }, href: "/", external: true, children: [] },
          { label: { en: "X" }, href: "javascript:alert(1)", external: false, children: [] },
          { label: { en: "Evil" }, href: "//evil.example", external: false, children: [] },
          { label: { en: "Data" }, href: "data:text/html,x", external: false, children: [] },
          { label: { en: "Shop" }, href: "https://shop.example", external: false, children: [] },
        ],
        [],
      ),
      "live",
    );
    expect(shell?.header.menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
      { label: { en: "Shop" }, href: "https://shop.example/", external: true, children: [] },
    ]);
  });

  it("policies are the known ones, once each, in policy order", () => {
    expect(parseShell(withMenus([], []), "live")?.footer.policies).toEqual(["refund", "terms"]);
  });

  it("a shell without menus parses as empty menus (Review Focus 2)", () => {
    const shell = parseShell(liveBody, "live");
    expect(shell?.header.menu).toEqual([]);
    expect(shell?.footer).toMatchObject({ menu: [], policies: [] });
  });

  it("the fallback shell has empty menus and no policies", () => {
    expect(FALLBACK_SHELL.header.menu).toEqual([]);
    expect(FALLBACK_SHELL.footer).toMatchObject({ menu: [], policies: [] });
  });
});

describe("textOf and clip (shared with content reads, preflight 16)", () => {
  it("clip cuts without leaving half a surrogate pair; textOf caps each locale", async () => {
    const { clip, textOf } = await import("./online-store");
    expect(clip("abc", 5)).toBe("abc");
    expect(clip(`a${"\u{1F600}"}`, 2)).toBe("a");
    expect(textOf({ en: "x".repeat(10), ar: "ب".repeat(3) }, 4)).toEqual({ ar: "ببب", en: "xxxx" });
    expect(textOf({ en: 5 }, 4)).toEqual({});
  });
});
