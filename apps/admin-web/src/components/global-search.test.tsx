import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { GlobalSearch } from "./global-search";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

beforeEach(() => {
  router.push.mockReset();
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
  it("lists Content, Files, Menus (in that order, contiguous) and Growth, and no Navigation or Marketing entry", () => {
    expect.hasAssertions();
    render(<GlobalSearch t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.topbar.search) }));

    const dialog = within(document.body).getByRole("dialog");
    const options = within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(
      expect.arrayContaining([en.nav.content, en.nav.files, en.nav.menus, en.nav.growth]),
    );
    const content = options.indexOf(en.nav.content);
    expect(options.slice(content, content + 3)).toEqual([
      en.nav.content,
      en.nav.files,
      en.nav.menus,
    ]);
    expect(options).not.toContain(en.nav.navigation);
    expect(options).not.toContain(en.nav.marketing);
  });

  it("lists Segments right after Customers and selecting it navigates to /customers/segments (Wave 1c)", () => {
    expect.hasAssertions();
    render(<GlobalSearch t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.topbar.search) }));

    const dialog = within(document.body).getByRole("dialog");
    const options = within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent);
    const customers = options.indexOf(en.nav.customers);
    expect(options.slice(customers, customers + 2)).toEqual([en.nav.customers, en.nav.segments]);

    fireEvent.click(within(dialog).getByRole("option", { name: en.nav.segments }));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/customers/segments");
  });

  it("selecting Files navigates to /content/files", () => {
    expect.hasAssertions();
    render(<GlobalSearch t={en} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.topbar.search) }));

    const dialog = within(document.body).getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("option", { name: en.nav.files }));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/content/files");
  });
});
