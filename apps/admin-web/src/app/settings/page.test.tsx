import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const mocks = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (mocks.locale === "en" ? undefined : { value: mocks.locale }),
    }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ name: "Staff" }) }));
vi.mock("@/lib/platform-tools", () => ({ showPlatformTools: () => false }));
vi.mock("@/lib/api/licensing", () => ({ fetchUsageCounters: vi.fn() }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const { default: SettingsPage } = await import("./page");

afterEach(() => {
  cleanup();
  mocks.locale = "en";
});

/** The landing list's row (the sub-navigation has a link to the same page, without the sentence). */
function adPlatformsRow(body: string): HTMLElement | undefined {
  return screen
    .getAllByRole("link")
    .find(
      (link) =>
        link.getAttribute("href") === "/settings/ad-platforms" &&
        (link.textContent ?? "").includes(body),
    );
}

describe("/settings landing page", () => {
  it("lists the Ad platforms row, linking to its page", async () => {
    expect.hasAssertions();
    render(await SettingsPage());

    const row = adPlatformsRow(en.settingsPage.adPlatformsBody);
    expect(row).toBeDefined();
    expect(row).toHaveTextContent(en.settingsPage.adPlatformsTitle);
  });

  it("says it in Arabic when the admin reads Arabic", async () => {
    expect.hasAssertions();
    mocks.locale = "ar";
    render(await SettingsPage());

    const row = adPlatformsRow(ar.settingsPage.adPlatformsBody);
    expect(row).toBeDefined();
    expect(row).toHaveTextContent(ar.settingsPage.adPlatformsTitle);
  });
});
