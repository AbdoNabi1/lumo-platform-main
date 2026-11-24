import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { SettingsFrame } from "./settings-frame";

afterEach(cleanup);

describe("SettingsFrame", () => {
  it("renders the settings nav and the page content, nav first, with logical classes only", () => {
    expect.hasAssertions();
    const { container } = render(
      <SettingsFrame t={en} activeId="general">
        <p>page body</p>
      </SettingsFrame>,
    );
    const nav = screen.getByRole("navigation", { name: en.settingsNav.label });
    const body = screen.getByText("page body");
    expect(within(nav).getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ")
      .split(/\s+/);
    expect(classes.filter((cls) => /(^|:)(ml|mr|pl|pr|left|right)-/.test(cls))).toEqual([]);
    expect(classes).toContain("lg:flex-row");
  });

  it("shows no current entry for the settings landing", () => {
    expect.hasAssertions();
    render(
      <SettingsFrame t={en}>
        <p>landing</p>
      </SettingsFrame>,
    );
    expect(screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))).toEqual(
      [],
    );
  });
});
