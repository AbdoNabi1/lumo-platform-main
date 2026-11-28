import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({
  fetchAdPlatforms: vi.fn(),
  fetchStoreSettings: vi.fn(),
  form: vi.fn(),
  locale: "en",
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale === "en" ? undefined : { value: mocks.locale }),
    }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/api/ad-platforms", () => ({ fetchAdPlatforms: mocks.fetchAdPlatforms }));
vi.mock("@/lib/api/store-settings", () => ({ fetchStoreSettings: mocks.fetchStoreSettings }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/settings/ad-platforms-form", () => ({
  AdPlatformsForm: (props: unknown) => {
    mocks.form(props);
    return <p>the form</p>;
  },
}));
const { default: Page } = await import("./page");

const ITEMS = ["meta", "tiktok", "snap", "ga4", "google_ads"].map((platform) => ({
  platform,
  version: 0,
}));

beforeEach(() => {
  cleanup();
  mocks.locale = "en";
  mocks.form.mockReset();
  mocks.fetchAdPlatforms.mockReset().mockResolvedValue({ outcome: "ok", items: ITEMS });
  mocks.fetchStoreSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", settings: { siteType: "lead_site" } });
});

describe("/settings/ad-platforms page", () => {
  it("renders the title inside the settings frame with its own entry current, and hands the form what it read", async () => {
    expect.hasAssertions();
    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: en.adPlatformsSettings.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: en.settingsNav.label })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/settings/ad-platforms"]);
    expect(mocks.form).toHaveBeenCalledWith(
      expect.objectContaining({ views: ITEMS, siteType: "lead_site" }),
    );
  });

  it("passes the store's site type, and none when the settings cannot be read", async () => {
    expect.hasAssertions();
    mocks.fetchStoreSettings.mockResolvedValue({ outcome: "ok", settings: { siteType: "store" } });
    render(await Page());
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ siteType: "store" }));

    cleanup();
    mocks.fetchStoreSettings.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await Page());
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ siteType: undefined }));
  });

  it("says so when the connections cannot be read, without showing the form", async () => {
    expect.hasAssertions();
    mocks.fetchAdPlatforms.mockResolvedValue({ outcome: "error", message: "boom" });
    render(await Page());

    expect(screen.getByText(en.adPlatformsSettings.loadError)).toBeInTheDocument();
    expect(mocks.form).not.toHaveBeenCalled();
  });

  it("asks to sign in when the read is unauthorized", async () => {
    expect.hasAssertions();
    mocks.fetchAdPlatforms.mockResolvedValue({ outcome: "unauthorized" });
    render(await Page());

    expect(screen.getByText(en.adPlatformsSettings.unauthorized)).toBeInTheDocument();
    expect(mocks.form).not.toHaveBeenCalled();
  });

  it("reads in Arabic when the admin does", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await Page());

    expect(
      screen.getByRole("heading", { level: 1, name: ar.adPlatformsSettings.title }),
    ).toBeInTheDocument();
  });
});
