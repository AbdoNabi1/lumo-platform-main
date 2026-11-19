import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type * as Navigation from "next/navigation";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof Navigation>()),
  usePathname: () => route.pathname,
}));
const { MobileMenu } = await import("./mobile-menu");

const entries = [
  { label: "Home", href: "/", external: false, children: [] },
  {
    label: "Shop",
    href: "/collections/all",
    external: false,
    children: [{ label: "Sale", href: "/collections/sale", external: false, children: [] }],
  },
];

describe("MobileMenu (spec 2.8)", () => {
  it("opens and closes with the button and Escape, moving focus in and back", () => {
    render(
      <MobileMenu
        entries={entries}
        previewToken={null}
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("the close button and the overlay close it too", () => {
    render(
      <MobileMenu
        entries={entries}
        previewToken={null}
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const overlay = document.body.querySelector(":scope > [data-overlay]");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("children are a nested disclosure; following a link closes the drawer", () => {
    render(
      <MobileMenu
        entries={entries}
        previewToken={null}
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const summary = screen
      .getAllByText("Shop")
      .map((label) => label.closest("summary"))
      .find((found) => found !== null);
    expect(summary?.parentElement?.tagName).toBe("DETAILS");
    expect(screen.getByRole("link", { name: "Sale" })).toHaveAttribute("href", "/collections/sale");
    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the preview token on internal links", () => {
    render(
      <MobileMenu
        entries={entries}
        previewToken="tok"
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/?preview=tok");
  });

  it("renders nothing for an empty menu", () => {
    const { container } = render(
      <MobileMenu
        entries={[]}
        previewToken={null}
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MobileMenu as a modal drawer (review I-1, I-2, M-1)", () => {
  const renderOpen = () => {
    const view = render(
      <MobileMenu
        entries={entries}
        previewToken={null}
        openLabel="Open"
        closeLabel="Close"
        title="Menu"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.click(trigger);
    return { ...view, trigger, dialog: screen.getByRole("dialog", { name: "Menu" }) };
  };

  it("renders the drawer and its overlay in document.body, outside the header's tree", () => {
    const { container, dialog } = renderOpen();
    expect(dialog.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
    const overlay = document.body.querySelector(":scope > [data-overlay]");
    expect(overlay).not.toBeNull();
    expect(container.contains(overlay)).toBe(false);
  });

  it("Tab and Shift+Tab wrap inside the drawer; a closed disclosure's links are skipped", () => {
    const { dialog } = renderOpen();
    const close = screen.getByRole("button", { name: "Close" });
    const summary = dialog.querySelector("summary") as HTMLElement;
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    // Opened, the disclosure's last link is the end of the cycle.
    summary.parentElement?.setAttribute("open", "");
    const sale = screen.getByRole("link", { name: "Sale" });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(sale);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("a Tab from outside the drawer is brought back into it", () => {
    renderOpen();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("makes the rest of the page inert while open, and restores it on close", () => {
    const before = document.createElement("div");
    before.setAttribute("inert", "");
    document.body.append(before);
    try {
      const { container, dialog, trigger } = renderOpen();
      expect(container).toHaveAttribute("inert");
      expect(dialog).not.toHaveAttribute("inert");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(container).not.toHaveAttribute("inert");
      expect(before).toHaveAttribute("inert");
      expect(document.activeElement).toBe(trigger);
    } finally {
      before.remove();
    }
  });

  it("the close button returns focus to the trigger after the page is no longer inert", () => {
    const { container, trigger } = renderOpen();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(container).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(trigger);
  });

  it("locks body scroll while open and restores the previous value on close and on unmount", () => {
    document.body.style.overflow = "scroll";
    try {
      const { unmount } = renderOpen();
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.body.style.overflow).toBe("scroll");
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(document.body.style.overflow).toBe("hidden");
      unmount();
      expect(document.body.style.overflow).toBe("scroll");
      expect(document.body.querySelector("[inert]")).toBeNull();
    } finally {
      document.body.style.overflow = "";
    }
  });
});

describe("MobileMenu on route changes and cleanup order (re-review)", () => {
  // A new element each time: rerendering the same element object would bail out of rendering.
  const menu = () => (
    <MobileMenu
      entries={entries}
      previewToken={null}
      openLabel="Open"
      closeLabel="Close"
      title="Menu"
    />
  );

  it("closes when the route changes another way (browser Back): page interactive, scroll back", () => {
    route.pathname = "/";
    document.body.style.overflow = "auto";
    try {
      const { container, rerender } = render(menu());
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(container).toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("hidden");
      route.pathname = "/collections/sale";
      rerender(menu());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(container).not.toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("auto");
    } finally {
      route.pathname = "/";
      document.body.style.overflow = "";
    }
  });

  it("restores focus to the trigger only once the page is no longer inert", () => {
    const { container } = render(menu());
    const trigger = screen.getByRole("button", { name: "Open" });
    // jsdom does not refuse focus on an inert element, so record the page's state at each call.
    const inertWhenFocused: boolean[] = [];
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(trigger, "focus").mockImplementation(function (this: HTMLElement, options) {
      inertWhenFocused.push(container.hasAttribute("inert"));
      focus.call(this, options);
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(inertWhenFocused).toEqual([false, false]);
    expect(document.activeElement).toBe(trigger);
  });
});
