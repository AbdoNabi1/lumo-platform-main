import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";

vi.mock("@/lib/request-locale", () => ({
  getRequestShell: async () => ({ ...FALLBACK_SHELL, storeName: "Nour" }),
  getRequestLocale: async () => "en",
}));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { default: NotFound } = await import("./not-found");

describe("NotFound (Ruling 23)", () => {
  it("renders inside the shop's own header and footer", async () => {
    render(await NotFound());
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Nour" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(screen.getByRole("contentinfo")).getByText(en.footer.poweredBy)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: en.notFound.title })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
