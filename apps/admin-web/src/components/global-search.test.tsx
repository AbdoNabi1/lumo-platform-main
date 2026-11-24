import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { GlobalSearch } from "./global-search";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GlobalSearch shares the sidebar's navigation (Shopify parity Wave 1a)", () => {
  it("lists Menus (under Content) and Growth (the marketing item) and no Navigation or Marketing entry", () => {
    expect.hasAssertions();
    render(<GlobalSearch t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.topbar.search) }));

    const dialog = within(document.body).getByRole("dialog");
    const options = within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining([en.nav.content, en.nav.menus, en.nav.growth]));
    expect(options.indexOf(en.nav.menus)).toBe(options.indexOf(en.nav.content) + 1);
    expect(options).not.toContain(en.nav.navigation);
    expect(options).not.toContain(en.nav.marketing);
  });
});
