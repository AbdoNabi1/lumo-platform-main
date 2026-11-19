import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
const requestHeaders = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue.value === undefined ? undefined : { value: cookieValue.value }),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));
const getStorefrontShell = vi.hoisted(() => vi.fn());
vi.mock("./online-store", () => ({ PREVIEW_HEADER: "x-morbeh-preview", getStorefrontShell }));
const { getLockedView, getRequestLocale } = await import("./request-locale");

beforeEach(() => {
  cookieValue.value = undefined;
  requestHeaders.clear();
  getStorefrontShell.mockResolvedValue({ defaultLocale: "en" });
});

describe("getRequestLocale (Ruling 22)", () => {
  it("prefers the shopper's cookie, else the shop's default language", async () => {
    cookieValue.value = "ar";
    expect(await getRequestLocale()).toBe("ar");
    cookieValue.value = "fr";
    expect(await getRequestLocale()).toBe("en");
    cookieValue.value = undefined;
    getStorefrontShell.mockResolvedValue({ defaultLocale: "ar" });
    expect(await getRequestLocale()).toBe("ar");
  });
});

describe("getLockedView (Ruling 5)", () => {
  it('is true only when the gate set its header to exactly "1"', async () => {
    expect(await getLockedView()).toBe(false);
    for (const value of ["", "0", "true", "1 ", " 1", "11"]) {
      requestHeaders.set("x-morbeh-locked-view", value);
      expect(await getLockedView(), JSON.stringify(value)).toBe(false);
    }
    requestHeaders.set("x-morbeh-locked-view", "1");
    expect(await getLockedView()).toBe(true);
  });
});
