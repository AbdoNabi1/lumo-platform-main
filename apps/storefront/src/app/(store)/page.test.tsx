import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL, type StorefrontShell } from "@/lib/online-store";
import { ar } from "@/messages/ar";

const request = vi.hoisted(() => ({ shell: null as StorefrontShell | null }));
vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => request.shell,
  getRequestLocale: async () => "ar",
}));
vi.mock("@/lib/catalog", () => ({
  AvailabilityBook: { load: async () => null },
  listPublishedProducts: async () => ({ status: "ok", products: [] }),
  listPublishedCollections: async () => ({ status: "ok", collections: [] }),
  priceOf: () => null,
}));
vi.mock("@/lib/runtime-api", () => ({ getCategories: async () => [] }));
const { default: Home } = await import("./page");

async function renderHome(storeName: string) {
  request.shell = { ...FALLBACK_SHELL, storeName };
  render(await Home());
}

describe("Home page heading (review M-1)", () => {
  it("has one visually hidden h1 with the store name", async () => {
    await renderHome("متجر النور");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("متجر النور");
    expect(heading).toHaveClass("sr-only");
    expect(heading.querySelector("bdi")).toHaveAttribute("dir", "auto");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("falls back to the page title when the shop has no name yet", async () => {
    await renderHome("");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ar.home.title);
  });
});
