import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type * as PlatformUi from "@platform/ui";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";

vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof PlatformUi>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { SiteHeader } = await import("./site-header");

describe("SiteHeader and the account link (Wave 2a)", () => {
  it("shows the account icon by default: today's header", () => {
    render(<SiteHeader t={en} locale="en" previewToken={null} shell={FALLBACK_SHELL} />);
    expect(screen.getByRole("link", { name: en.nav.account })).toHaveAttribute("href", "/account");
  });

  it("hides the account icon, and only it, when told to", () => {
    render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={FALLBACK_SHELL}
        showAccountLink={false}
      />,
    );
    expect(screen.queryByRole("link", { name: en.nav.account })).toBeNull();
    expect(screen.getByRole("link", { name: en.nav.cart })).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });
});
