import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileMenu } from "./mobile-menu";

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
    const { container } = render(
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
    const overlay = container.querySelector("[data-overlay]");
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
