import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";

const request = vi.hoisted(() => ({
  shell: null as StorefrontShell | null,
  lockedView: false,
  host: "shop.example" as string | null,
  shellReads: 0,
}));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => {
    request.shellReads += 1;
    return request.shell;
  },
  getLockedView: async () => request.lockedView,
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "host" ? request.host : null) }),
}));
const getSitemapPaths = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sitemap", () => ({ getSitemapPaths }));
const { default: sitemap } = await import("./sitemap");

beforeEach(() => {
  request.shell = FALLBACK_SHELL;
  request.lockedView = false;
  request.host = "shop.example";
  request.shellReads = 0;
  getSitemapPaths.mockReset();
  getSitemapPaths.mockResolvedValue([{ path: "/" }]);
});

describe("sitemap.xml (Decision 35, spec 2.8)", () => {
  it("sitemap: locked is empty and never reads (Decision 35)", async () => {
    request.shell = { ...FALLBACK_SHELL, locked: true };
    expect(await sitemap()).toEqual([]);
    expect(getSitemapPaths).not.toHaveBeenCalled();
  });

  it("the locked view empties it even with FALLBACK_SHELL, with no Runtime reads (preflight 2)", async () => {
    request.lockedView = true;
    request.shell = FALLBACK_SHELL;
    expect(await sitemap()).toEqual([]);
    expect(getSitemapPaths).not.toHaveBeenCalled();
    expect(request.shellReads).toBe(0);
  });

  it("sitemap: absolute URLs on the request host, with lastModified where known", async () => {
    getSitemapPaths.mockResolvedValue([
      { path: "/" },
      { path: "/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
    ]);
    expect(await sitemap()).toEqual([
      { url: "https://shop.example/" },
      { url: "https://shop.example/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
    ]);
  });

  it("sitemap: a failed read or an invalid host is empty, not an error", async () => {
    getSitemapPaths.mockRejectedValue(new Error("down"));
    expect(await sitemap()).toEqual([]);
    getSitemapPaths.mockReset();
    getSitemapPaths.mockResolvedValue([{ path: "/" }]);
    for (const host of ["evil.example/x", null, "a b", "x..y"]) {
      request.host = host;
      expect(await sitemap(), String(host)).toEqual([]);
    }
    expect(getSitemapPaths).not.toHaveBeenCalled();
  });
});
