import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue.value === undefined ? undefined : { value: cookieValue.value }),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));
const getStorefrontShell = vi.hoisted(() => vi.fn());
vi.mock("./online-store", () => ({ PREVIEW_HEADER: "x-morbeh-preview", getStorefrontShell }));
const { getRequestLocale } = await import("./request-locale");

beforeEach(() => {
  cookieValue.value = undefined;
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
