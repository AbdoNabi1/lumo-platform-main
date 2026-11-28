import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  DEFAULT_THEME_DOCUMENT,
  newSection,
  sectionHeading,
  type Section,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { ThemeTargetsDto } from "@/lib/api/online-store";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { SectionTreePanel, type SectionTreePanelProps } from "./section-tree-panel";

const s = en.onlineStoreSections;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID1 = uuid(1);
const ID2 = uuid(2);
const ID3 = uuid(3);

const rich = (id: string, heading: string): Section => {
  const base = newSection("rich_text", id);
  return { ...base, settings: { ...base.settings, heading: { ar: heading, en: heading } } };
};
const docWith = (
  sections: readonly Section[],
  announcement: ThemeDocument["header"]["announcement"] = null,
): ThemeDocument => ({
  ...DEFAULT_THEME_DOCUMENT,
  header: { ...DEFAULT_THEME_DOCUMENT.header, announcement },
  homepage: { ...DEFAULT_THEME_DOCUMENT.homepage, sections },
});

beforeEach(() => {
  expect.hasAssertions();
});

function Harness({
  doc: initial,
  onSelect = vi.fn(),
  onUpdateSpy = vi.fn(),
  ...rest
}: {
  readonly doc: ThemeDocument;
  readonly onSelect?: (id: string | null) => void;
  readonly onUpdateSpy?: () => void;
} & Partial<SectionTreePanelProps>) {
  const [doc, setDoc] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <aside data-testid="sections-aside">
      <SectionTreePanel
        t={en}
        locale="en"
        doc={doc}
        targets={null}
        images={{}}
        errors={{}}
        selectedId={selectedId}
        disabled={false}
        menus={[{ handle: "main-menu", title: "Main menu" }]}
        siteType="store"
        onSelect={(id) => {
          onSelect(id);
          setSelectedId(id);
        }}
        onUpdate={(change) => {
          onUpdateSpy();
          setDoc((d) => change(d));
        }}
        {...rest}
      />
    </aside>
  );
}

const rowTitles = () =>
  Array.from(document.querySelectorAll("[data-section-row] button bdi")).map(
    (el) => el.textContent,
  );
/** The select button of a row by its exact title (the Add buttons also start with "A"). */
const rowButton = (title: string, index = 0) =>
  screen
    .getAllByRole("button")
    .filter(
      (b) => b.querySelector("bdi")?.textContent === title && b.closest("[data-section-row]"),
    )[index] as HTMLElement;
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name: s.more.replace("{name}", name) }), {
    key: "Enter",
  });
const choose = async (item: string) =>
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("SectionTreePanel", () => {
  it("focus after move, remove and duplicate (Review Focus 5, Ruling 22)", async () => {
    render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B"), rich(ID3, "C")])} />);
    // Alt+Down on A: A moves below B and keeps focus
    rowButton("A").focus();
    fireEvent.keyDown(rowButton("A"), { key: "ArrowDown", altKey: true });
    expect(rowTitles()).toEqual(["B", "A", "C"]);
    expect(document.activeElement).toBe(rowButton("A"));
    // remove A through the menu and the confirmation: focus goes to the next row, C
    openMenu("A");
    await choose(s.remove);
    fireEvent.click(await screen.findByRole("button", { name: s.confirmRemoveButton }));
    await settle();
    expect(rowTitles()).toEqual(["B", "C"]);
    await waitFor(() => expect(document.activeElement).toBe(rowButton("C")));
    // duplicate C: the copy is selected and focused
    openMenu("C");
    await choose(s.duplicate);
    await settle();
    expect(rowTitles()).toEqual(["B", "C", "C"]);
    await waitFor(() => expect(document.activeElement).toBe(rowButton("C", 1)));
    expect(rowButton("C", 1)).toHaveAttribute("aria-current", "true");
  });

  it("a move from the menu keeps focus on the moved row", async () => {
    render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B")])} />);
    openMenu("B");
    await choose(s.moveUp);
    await settle();
    expect(rowTitles()).toEqual(["B", "A"]);
    await waitFor(() => expect(document.activeElement).toBe(rowButton("B")));
  });

  it("removing the last row of the list focuses the previous one, then Add section", async () => {
    render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B")])} />);
    openMenu("B");
    await choose(s.remove);
    fireEvent.click(await screen.findByRole("button", { name: s.confirmRemoveButton }));
    await settle();
    await waitFor(() => expect(document.activeElement).toBe(rowButton("A")));
    openMenu("A");
    await choose(s.remove);
    fireEvent.click(await screen.findByRole("button", { name: s.confirmRemoveButton }));
    await settle();
    expect(rowTitles()).toEqual([]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: s.addSection })),
    );
  });

  it("cancelling the removal changes nothing", async () => {
    const onUpdateSpy = vi.fn();
    render(<Harness doc={docWith([rich(ID1, "A")])} onUpdateSpy={onUpdateSpy} />);
    openMenu("A");
    await choose(s.remove);
    fireEvent.click(await screen.findByRole("button", { name: s.cancel }));
    await settle();
    expect(onUpdateSpy).not.toHaveBeenCalled();
    expect(rowTitles()).toEqual(["A"]);
  });

  it("the eye toggle hides and shows, with aria-pressed and the section's name", () => {
    render(<Harness doc={docWith([rich(ID1, "A")])} />);
    const hide = screen.getByRole("button", { name: s.hide.replace("{name}", "A") });
    expect(hide).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(s.hiddenBadge)).toBeNull();
    fireEvent.click(hide);
    const show = screen.getByRole("button", { name: s.show.replace("{name}", "A") });
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(s.hiddenBadge)).toBeInTheDocument();
    fireEvent.click(show);
    expect(screen.getByRole("button", { name: s.hide.replace("{name}", "A") })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("the menu is portalled out of the sidebar", async () => {
    render(<Harness doc={docWith([rich(ID1, "A")])} />);
    openMenu("A");
    const menu = await screen.findByRole("menu");
    expect(document.body.contains(menu)).toBe(true);
    expect(screen.getByTestId("sections-aside").contains(menu)).toBe(false);
  });

  it("the remove confirmation is portalled out of the sidebar", async () => {
    render(<Harness doc={docWith([rich(ID1, "A")])} />);
    openMenu("A");
    await choose(s.remove);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByTestId("sections-aside").contains(dialog)).toBe(false);
    expect(within(dialog).getByText(s.confirmRemove)).toBeInTheDocument();
  });

  it("Move up is disabled on the first row, Move down on the last; Duplicate at 25 sections", async () => {
    const { unmount } = render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B")])} />);
    openMenu("A");
    expect(await screen.findByRole("menuitem", { name: s.moveUp })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: s.moveDown })).not.toHaveAttribute("aria-disabled");
    unmount();

    const second = render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B")])} />);
    openMenu("B");
    expect(await screen.findByRole("menuitem", { name: s.moveDown })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    second.unmount();

    const full = Array.from({ length: 25 }, (_, i) => rich(uuid(i + 1), `S${i + 1}`));
    render(<Harness doc={docWith(full)} />);
    openMenu("S2");
    expect(await screen.findByRole("menuitem", { name: s.duplicate })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText(s.limitReached)).toBeInTheDocument();
  });

  it("Alt+arrow at an end does nothing", () => {
    const onUpdateSpy = vi.fn();
    render(<Harness doc={docWith([rich(ID1, "A"), rich(ID2, "B")])} onUpdateSpy={onUpdateSpy} />);
    fireEvent.keyDown(rowButton("A"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(rowButton("B"), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(rowButton("B"), { key: "ArrowUp" }); // no Alt: plain navigation
    expect(onUpdateSpy).not.toHaveBeenCalled();
    expect(rowTitles()).toEqual(["A", "B"]);
  });

  it("titles are the first heading or the type name, isolated with <bdi dir=auto>", () => {
    const empty = newSection("hero", ID2); // the default hero has no heading text
    const arabic = String.fromCharCode(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
    render(
      <Harness
        doc={docWith([
          rich(ID1, arabic),
          { ...empty, settings: { ...empty.settings, heading: { ar: "", en: "" } } },
        ])}
      />,
    );
    const bdis = Array.from(document.querySelectorAll("[data-section-row] button bdi"));
    expect(bdis.map((b) => b.textContent)).toEqual([arabic, "Image banner"]);
    for (const bdi of bdis) expect(bdi).toHaveAttribute("dir", "auto");
  });

  it("uses the Arabic type names and copy for an Arabic admin", () => {
    const empty = newSection("whatsapp_cta", ID1);
    render(
      <Harness
        t={ar}
        locale="ar"
        doc={docWith([{ ...empty, settings: { ...empty.settings, heading: { ar: "", en: "" } } }])}
      />,
    );
    expect(
      screen.getByRole("button", { name: ar.onlineStoreSections.addSection }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: ar.onlineStoreSections.template }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-section-row] button bdi")?.textContent).not.toBe("");
  });

  it("a section with a removed collection shows the problem dot; an unsupported one says so", () => {
    const collection = newSection("featured_collection", ID1);
    const picked = {
      ...collection,
      settings: { ...collection.settings, collection: "11111111-1111-4111-8111-111111111111" },
    } as unknown as Section;
    const future = { id: ID2, type: "countdown_timer", hidden: false, settings: { x: 1 } };
    const targets: ThemeTargetsDto = { collection: {}, product: {}, page: {} };
    render(<Harness doc={docWith([picked, future])} targets={targets} />);
    const rows = Array.from(document.querySelectorAll("[data-section-row]"));
    expect(
      within(rows[0] as HTMLElement).getByRole("img", { name: s.hasProblem }),
    ).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).queryByRole("img")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText(s.unsupported)).toBeInTheDocument();
  });

  it("no problem dot while the targets are unknown (null)", () => {
    const collection = newSection("featured_collection", ID1);
    const picked = {
      ...collection,
      settings: { ...collection.settings, collection: "11111111-1111-4111-8111-111111111111" },
    } as unknown as Section;
    render(<Harness doc={docWith([picked])} targets={null} />);
    expect(screen.queryByRole("img", { name: s.hasProblem })).toBeNull();
  });

  it("a field error on a section's path shows the dot on its row", () => {
    render(
      <Harness
        doc={docWith([rich(ID1, "A"), rich(ID2, "B")])}
        errors={{ "homepage.sections.1.settings.heading.en": "x" }}
      />,
    );
    const rows = Array.from(document.querySelectorAll("[data-section-row]")) as HTMLElement[];
    expect(within(rows[0]!).queryByRole("img")).toBeNull();
    expect(within(rows[1]!).getByRole("img", { name: s.hasProblem })).toBeInTheDocument();
  });

  it("a viewer sees the tree read-only (every control disabled)", () => {
    render(
      <Harness doc={docWith([rich(ID1, "A")], newSection("announcement_bar", ID2))} disabled />,
    );
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("combobox")];
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) expect(control).toBeDisabled();
  });

  it("Add section opens the picker, appends the type and selects the new section", async () => {
    const onSelect = vi.fn();
    render(<Harness doc={docWith([rich(ID1, "A")])} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: s.addSection }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector('button[data-section-type="announcement_bar"]')).toBeNull();
    fireEvent.click(dialog.querySelector('button[data-section-type="hero"]')!);
    await settle();
    expect(rowTitles()).toEqual(["A", sectionHeading(newSection("hero", ID1), "en")]);
    const selected = onSelect.mock.calls[0]![0] as string;
    expect(document.querySelector(`[data-section-row="${selected}"]`)).not.toBeNull();
    expect(selected).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the announcement slot: Add announcement, a row once set, remove returns focus to Add", async () => {
    render(<Harness doc={docWith([rich(ID1, "A")])} />);
    fireEvent.click(screen.getByRole("button", { name: s.addAnnouncement }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector('button[data-section-type="announcement_bar"]')!);
    await settle();
    expect(screen.queryByRole("button", { name: s.addAnnouncement })).toBeNull();
    const row = document.querySelector("[data-section-row]")!;
    const barTitle = sectionHeading(newSection("announcement_bar", ID1), "en");
    expect(rowTitles()).toEqual([barTitle, "A"]);
    expect(row).toBeInTheDocument();
    openMenu(barTitle!);
    expect(screen.queryByRole("menuitem", { name: s.moveUp })).toBeNull();
    await choose(s.remove);
    fireEvent.click(await screen.findByRole("button", { name: s.confirmRemoveButton }));
    await settle();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: s.addAnnouncement })),
    );
  });

  it("the tree has the Header, Template and Footer groups with their panels", () => {
    render(<Harness doc={docWith([rich(ID1, "A")])} />);
    for (const name of [s.header, s.template, s.footer]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText(en.onlineStoreCustomize.headerMenu)).toBeInTheDocument();
    expect(screen.getByLabelText(en.onlineStoreCustomize.stickyHeader)).toBeInTheDocument();
    expect(screen.getByLabelText(en.onlineStoreCustomize.footerMenu)).toBeInTheDocument();
    expect(screen.getByLabelText(en.onlineStoreCustomize.showPolicyLinks)).toBeInTheDocument();
    expect(screen.getByLabelText(en.onlineStoreCustomize.showSocial)).toBeInTheDocument();
    expect(screen.getByText(en.onlineStoreCustomize.footerNote)).toBeInTheDocument();
  });
});
