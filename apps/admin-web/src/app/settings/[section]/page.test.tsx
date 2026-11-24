import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const { default: SectionPage } = await import("./page");

beforeEach(() => {
  cleanup();
  mocks.notFound.mockClear();
});

describe("/settings/[section] coming-soon page", () => {
  it("renders the Checkout title, the coming-soon text and a link back to /settings", async () => {
    expect.hasAssertions();
    render(await SectionPage({ params: Promise.resolve({ section: "checkout" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Checkout" })).toBeInTheDocument();
    expect(screen.getByText(en.settingsNav.comingSoon)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.settingsNav.backToSettings })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders inside the settings frame with the section's own entry current", async () => {
    expect.hasAssertions();
    render(await SectionPage({ params: Promise.resolve({ section: "checkout" }) }));
    expect(screen.getByRole("navigation", { name: en.settingsNav.label })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/settings/checkout"]);
  });

  it.each([
    "checkout",
    "customer-accounts",
    "markets",
    "apps",
    "customer-events",
    "notifications",
    "custom-data",
    "customer-privacy",
  ])("accepts the unavailable section %s", async (section) => {
    expect.hasAssertions();
    render(await SectionPage({ params: Promise.resolve({ section }) }));
    expect(screen.getByText(en.settingsNav.comingSoon)).toBeInTheDocument();
  });

  it.each(["nope", "general", "billing", "locations", "plan", "languages", "users"])(
    "calls notFound for %s (not one of the eight unavailable ids)",
    async (section) => {
      expect.hasAssertions();
      await expect(SectionPage({ params: Promise.resolve({ section }) })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(mocks.notFound).toHaveBeenCalledTimes(1);
    },
  );
});
