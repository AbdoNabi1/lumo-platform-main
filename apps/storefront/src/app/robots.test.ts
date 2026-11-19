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
const { default: robots } = await import("./robots");

beforeEach(() => {
  request.shell = FALLBACK_SHELL;
  request.lockedView = false;
  request.host = "shop.example";
  request.shellReads = 0;
});

describe("robots.txt (Decision 35, spec 2.8)", () => {
  it("locked: Disallow everything and no sitemap line (Decision 35)", async () => {
    request.shell = { ...FALLBACK_SHELL, locked: true };
    expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("the locked view closes it even when the shell read failed (FALLBACK_SHELL, preflight 2)", async () => {
    request.lockedView = true;
    request.shell = FALLBACK_SHELL;
    expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(request.shellReads).toBe(0);
  });

  it("unlocked: allow /, disallow the private paths, and point at the sitemap on this host", async () => {
    expect(await robots()).toEqual({
      rules: [
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/cart", "/checkout", "/account", "/c/", "/password"],
        },
      ],
      sitemap: "https://shop.example/sitemap.xml",
    });
  });

  it("an invalid host gives no sitemap line", async () => {
    for (const host of ["evil.example/x", "a b", null, "user@shop.example"]) {
      request.host = host;
      const result = await robots();
      expect(result, String(host)).not.toHaveProperty("sitemap");
      expect(result.rules).toEqual([
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/cart", "/checkout", "/account", "/c/", "/password"],
        },
      ]);
    }
  });
});
