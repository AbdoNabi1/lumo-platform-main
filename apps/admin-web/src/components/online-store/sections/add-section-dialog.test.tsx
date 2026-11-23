import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_THEME_DOCUMENT,
  newSection,
  SECTION_DEFINITIONS,
  type Section,
  type ThemeDocument,
} from "@platform/storefront-content";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { AddSectionDialog } from "./add-section-dialog";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const docWith = (sections: readonly Section[]): ThemeDocument => ({
  ...DEFAULT_THEME_DOCUMENT,
  homepage: { ...DEFAULT_THEME_DOCUMENT.homepage, sections },
});

beforeEach(() => {
  expect.hasAssertions();
});

function setup(props: Partial<React.ComponentProps<typeof AddSectionDialog>> = {}) {
  const onAdd = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <AddSectionDialog
      t={en}
      locale="en"
      open
      onOpenChange={onOpenChange}
      doc={DEFAULT_THEME_DOCUMENT}
      placement="homepage"
      siteType="store"
      onAdd={onAdd}
      {...props}
    />,
  );
  return { onAdd, onOpenChange, ...view };
}

describe("AddSectionDialog", () => {
  it("a store's homepage placement lists nine types (all but the lead form) with name and description", () => {
    setup();
    const homepage = SECTION_DEFINITIONS.filter(
      (d) => d.placement === "homepage" && d.type !== "lead_form",
    );
    expect(homepage).toHaveLength(9);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("button[data-section-type]")).toHaveLength(9);
    for (const definition of homepage) {
      const button = dialog.querySelector(`button[data-section-type="${definition.type}"]`)!;
      expect(button).toHaveTextContent(definition.labels.en);
      expect(button).toHaveTextContent(
        en.onlineStoreSections.descriptions[
          definition.type as keyof typeof en.onlineStoreSections.descriptions
        ],
      );
    }
    expect(dialog.querySelector('button[data-section-type="announcement_bar"]')).toBeNull();
  });

  it("a lead site is offered the lead form and none of the commerce sections", () => {
    setup({ siteType: "lead_site" });
    const types = Array.from(
      screen.getByRole("dialog").querySelectorAll("button[data-section-type]"),
    ).map((b) => b.getAttribute("data-section-type"));
    expect(types).toContain("lead_form");
    for (const commerce of ["featured_collection", "featured_products", "collection_list"]) {
      expect(types).not.toContain(commerce);
    }
    expect(screen.getByText("Lead form")).toBeInTheDocument();
    expect(screen.queryByText("Featured products")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      en.onlineStoreSections.descriptions.lead_form,
    );
    expect(types).toContain("hero");
  });

  it("a store, or an unknown site type, is not offered the lead form but keeps commerce", () => {
    for (const siteType of ["store", null] as const) {
      const { unmount } = setup({ siteType });
      const types = Array.from(
        screen.getByRole("dialog").querySelectorAll("button[data-section-type]"),
      ).map((b) => b.getAttribute("data-section-type"));
      expect(types, String(siteType)).not.toContain("lead_form");
      expect(types, String(siteType)).toEqual(
        expect.arrayContaining(["featured_collection", "featured_products", "collection_list"]),
      );
      unmount();
    }
  });

  it("the lead form can be added once: a second is disabled by the type limit", () => {
    setup({ siteType: "lead_site", doc: docWith([newSection("lead_form", id(1))]) });
    const button = screen
      .getByRole("dialog")
      .querySelector('button[data-section-type="lead_form"]')!;
    expect(button).toBeDisabled();
    expect(document.getElementById(button.getAttribute("aria-describedby")!)).toHaveTextContent(
      en.onlineStoreSections.typeLimit.replace("{max}", "1"),
    );
  });

  it("the Arabic description of the lead form is shown to an Arabic admin", () => {
    setup({ t: ar, locale: "ar", siteType: "lead_site" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "فورم بيجمع اسم العميل وتليفونه (وإيميله ورسالته لو حبيت) ويوصلك في صندوق الليدز",
    );
    expect(screen.getByText("فورم العملاء")).toBeInTheDocument();
  });

  it("the header placement lists only the announcement bar", () => {
    setup({ placement: "header" });
    const buttons = screen.getByRole("dialog").querySelectorAll("button[data-section-type]");
    expect(Array.from(buttons).map((b) => b.getAttribute("data-section-type"))).toEqual([
      "announcement_bar",
    ]);
  });

  it("uses the Arabic names for an Arabic admin", () => {
    setup({ t: ar, locale: "ar" });
    const hero = SECTION_DEFINITIONS.find((d) => d.type === "hero")!;
    expect(
      screen.getByRole("dialog").querySelector('button[data-section-type="hero"]'),
    ).toHaveTextContent(hero.labels.ar);
    expect(screen.getByRole("dialog")).toHaveTextContent(ar.onlineStoreSections.descriptions.hero);
  });

  it("with 3 heroes the hero option is disabled and described by the type limit", () => {
    setup({
      doc: docWith([
        newSection("hero", id(1)),
        newSection("hero", id(2)),
        newSection("hero", id(3)),
      ]),
    });
    const hero = screen.getByRole("dialog").querySelector('button[data-section-type="hero"]')!;
    expect(hero).toBeDisabled();
    const reason = document.getElementById(hero.getAttribute("aria-describedby")!)!;
    expect(reason).toHaveTextContent(en.onlineStoreSections.typeLimit.replace("{max}", "3"));
    const rich = screen.getByRole("dialog").querySelector('button[data-section-type="rich_text"]')!;
    expect(rich).not.toBeDisabled();
    expect(rich.getAttribute("aria-describedby")).toBeNull();
  });

  it("at 25 sections every option is disabled with the limit reason", () => {
    const sections = Array.from({ length: 25 }, (_, i) => newSection("rich_text", id(i + 1)));
    setup({ doc: docWith(sections) });
    const buttons = screen.getByRole("dialog").querySelectorAll("button[data-section-type]");
    expect(buttons).toHaveLength(9);
    for (const button of Array.from(buttons)) {
      expect(button).toBeDisabled();
      expect(document.getElementById(button.getAttribute("aria-describedby")!)).toHaveTextContent(
        en.onlineStoreSections.limitReached,
      );
    }
  });

  it("a full announcement slot disables the announcement option", () => {
    setup({
      placement: "header",
      doc: {
        ...DEFAULT_THEME_DOCUMENT,
        header: {
          ...DEFAULT_THEME_DOCUMENT.header,
          announcement: newSection("announcement_bar", id(9)),
        },
      },
    });
    const bar = screen.getByRole("dialog").querySelector("button[data-section-type]")!;
    expect(bar).toBeDisabled();
    expect(document.getElementById(bar.getAttribute("aria-describedby")!)).toHaveTextContent(
      en.onlineStoreSections.typeLimit.replace("{max}", "1"),
    );
  });

  it("picking calls onAdd with the type and closes", () => {
    const { onAdd, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("dialog").querySelector('button[data-section-type="hero"]')!);
    expect(onAdd).toHaveBeenCalledWith("hero");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("the content is portalled under document.body, not inside the caller's tree", () => {
    const { container } = setup();
    const dialog = screen.getByRole("dialog");
    expect(document.body.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);
    expect(
      screen.getByRole("heading", { name: en.onlineStoreSections.pickerTitle }),
    ).toBeInTheDocument();
  });
});
