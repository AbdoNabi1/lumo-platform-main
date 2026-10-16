import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublicStore = vi.fn();
vi.mock("@/lib/runtime-api", () => ({
  getPublicStore: (...args: unknown[]) => getPublicStore(...args),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "geist" } }));
vi.mock("@fontsource/ibm-plex-sans-arabic/400.css", () => ({}));
vi.mock("@fontsource/ibm-plex-sans-arabic/500.css", () => ({}));
vi.mock("@fontsource/ibm-plex-sans-arabic/600.css", () => ({}));
vi.mock("./globals.css", () => ({}));

const { generateMetadata } = await import("./layout");

beforeEach(() => {
  getPublicStore.mockReset();
});

describe("generateMetadata (Plan 3C)", () => {
  it("titles the tab with the store's name", async () => {
    getPublicStore.mockResolvedValue({ name: "Lumo", currency: "EGP" });

    expect((await generateMetadata()).title).toBe("Lumo");
  });

  it('falls back to "Store" while the name is empty', async () => {
    getPublicStore.mockResolvedValue({ name: "", currency: "EGP" });

    expect((await generateMetadata()).title).toBe("Store");
  });

  it('falls back to "Store" when the shop cannot be read', async () => {
    getPublicStore.mockResolvedValue(null);

    expect((await generateMetadata()).title).toBe("Store");
  });

  it("never shows the old placeholder title", async () => {
    getPublicStore.mockResolvedValue(null);

    expect(JSON.stringify(await generateMetadata())).not.toContain("foundation");
  });
});
