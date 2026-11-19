import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { POLICY_TITLES } from "@platform/storefront-content";
import type { MenuDto, MenuItemViewDto } from "@/lib/api/online-store";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveMenuAction: vi.fn(),
  createMenuAction: vi.fn(),
  deleteMenuAction: vi.fn(),
  searchLinkTargetsAction: vi.fn(),
}));
vi.mock("@/app/online-store/navigation/actions", () => actions);
const { MenuEditor } = await import("./menu-editor");

const n = en.onlineStoreNavigation;
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const view = (
  k: number,
  label: string,
  link: MenuItemViewDto["link"],
  extra: Partial<MenuItemViewDto> = {},
): MenuItemViewDto => ({
  id: id(k),
  label: { en: label },
  link,
  broken: false,
  targetTitle: null,
  children: [],
  ...extra,
});
const footerView: MenuItemViewDto[] = [
  view(1, "Find", { type: "search" }),
  view(2, "Terms", { type: "policy", policy: "terms" }, { targetTitle: "terms" }),
];
/** The same items as the editor sends them: no view-only fields. */
const footerItems = [
  { id: id(1), label: { en: "Find" }, link: { type: "search" }, children: [] },
  { id: id(2), label: { en: "Terms" }, link: { type: "policy", policy: "terms" }, children: [] },
];
const footerMenu: MenuDto = {
  id: null,
  handle: "footer",
  title: "Footer menu",
  isDefault: true,
  version: 4,
  items: footerView,
};

beforeEach(() => {
  actions.searchLinkTargetsAction.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  for (const fn of Object.values(actions)) fn.mockReset();
  vi.restoreAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

const openAddDialog = (t: Dictionary = en) =>
  fireEvent.click(screen.getByRole("button", { name: t.onlineStoreNavigation.addItem }));

describe("MenuEditor (spec 2.7)", () => {
  it("adds an item through the dialog and saves the tree with the version", async () => {
    actions.saveMenuAction.mockResolvedValue({ status: "success", menu: footerMenu });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    expect(screen.queryByText(n.unsaved)).toBeNull();
    openAddDialog();
    fireEvent.change(screen.getByLabelText(n.labelEn), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "home" } });
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    expect(screen.getByText(n.unsaved)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(actions.saveMenuAction).toHaveBeenCalledWith({
      handle: "footer",
      title: footerMenu.title,
      expectedVersion: footerMenu.version,
      items: [
        ...footerItems,
        { id: expect.any(String), label: { en: "Home" }, link: { type: "home" }, children: [] },
      ],
    });
    // The saved menu replaces the editor's state: nothing is left unsaved.
    expect(screen.queryByText(n.unsaved)).toBeNull();
  });

  it("offers Add sub-item on top-level rows only, and Move up/Move down as buttons", async () => {
    const menu: MenuDto = {
      ...footerMenu,
      items: [
        view(1, "A", { type: "home" }, { children: [view(3, "Child", { type: "search" })] }),
        view(2, "B", { type: "search" }),
      ],
    };
    actions.saveMenuAction.mockResolvedValue({ status: "success", menu });
    render(<MenuEditor t={en} locale="en" menu={menu} canEdit />);
    // Two top-level rows offer a sub-item; the child does not.
    expect(screen.getAllByRole("button", { name: /Add sub-item/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Move A up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move B down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Child up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move A down" }));
    const rows = screen
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.getAttribute("data-level") === "1");
    expect(rows.map((li) => li.querySelector("bdi")?.textContent)).toEqual(["B", "A"]);
    expect(screen.getByRole("button", { name: "Move A up" })).toBeEnabled();
    // Add a sub-item under B.
    fireEvent.click(screen.getByRole("button", { name: "Add sub-item under B" }));
    fireEvent.change(screen.getByLabelText(n.labelEn), { target: { value: "Under B" } });
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    const sent = actions.saveMenuAction.mock.calls[0]?.[0] as {
      items: { label: { en: string }; children: { label: { en: string } }[] }[];
    };
    expect(sent.items.map((i) => i.label.en)).toEqual(["B", "A"]);
    expect(sent.items[0]?.children.map((c) => c.label.en)).toEqual(["Under B"]);
    expect(sent.items[1]?.children.map((c) => c.label.en)).toEqual(["Child"]);
  });

  describe("keyboard focus stays in the tree (review I-1)", () => {
    const abcd: MenuDto = {
      ...footerMenu,
      items: [
        view(1, "A", { type: "home" }, { children: [view(5, "Only child", { type: "search" })] }),
        view(2, "B", { type: "search" }),
        view(3, "C", { type: "home" }),
        view(4, "D", { type: "search" }),
      ],
    };
    const button = (name: string) => screen.getByRole("button", { name });
    const press = (name: string) => {
      const target = button(name);
      target.focus();
      fireEvent.click(target);
    };

    it("after Delete: the next row, else the previous one, else the parent, else Add menu item", () => {
      render(<MenuEditor t={en} locale="en" menu={abcd} canEdit />);
      press("Delete B");
      expect(document.activeElement).toBe(button("Edit C"));
      press("Delete D");
      expect(document.activeElement).toBe(button("Edit C"));
      press("Delete Only child");
      expect(document.activeElement).toBe(button("Edit A"));
      press("Delete A");
      expect(document.activeElement).toBe(button("Edit C"));
      press("Delete C");
      expect(document.activeElement).toBe(button(n.addItem));
    });

    it("a move to the top or the bottom lands on the other arrow; a middle move keeps its arrow", () => {
      render(<MenuEditor t={en} locale="en" menu={abcd} canEdit />);
      press("Move B up"); // to the top: Move B up is now disabled
      expect(button("Move B up")).toBeDisabled();
      expect(document.activeElement).toBe(button("Move B down"));
      press("Move C down"); // to the bottom
      expect(button("Move C down")).toBeDisabled();
      expect(document.activeElement).toBe(button("Move C up"));
      press("Move C up"); // middle: B A D C -> B A C D
      expect(button("Move C up")).toBeEnabled();
      expect(document.activeElement).toBe(button("Move C up"));
      const order = screen
        .getAllByRole("listitem")
        .filter((li) => li.parentElement?.getAttribute("data-level") === "1")
        .map((li) => li.querySelector("bdi")?.textContent);
      expect(order).toEqual(["B", "A", "C", "D"]);
    });
  });

  it("reorders by drag and drop within one level, and hands Firefox the drag data", () => {
    const menu: MenuDto = {
      ...footerMenu,
      items: [
        view(1, "A", { type: "home" }, { children: [view(3, "Child", { type: "search" })] }),
        view(2, "B", { type: "search" }),
      ],
    };
    render(<MenuEditor t={en} locale="en" menu={menu} canEdit />);
    const rowOf = (label: string) => screen.getByText(label).closest("li")!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "all" };
    // Dropping a child on a top-level row changes nothing, and is not an edit.
    fireEvent.dragStart(rowOf("Child"), { dataTransfer });
    fireEvent.drop(rowOf("B"));
    expect(screen.queryByText(n.unsaved)).toBeNull();
    fireEvent.dragStart(rowOf("A"), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenLastCalledWith("text/plain", id(1));
    expect(dataTransfer.effectAllowed).toBe("move");
    fireEvent.dragOver(rowOf("B"));
    fireEvent.drop(rowOf("B"));
    const labels = screen
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.getAttribute("data-level") === "1")
      .map((li) => li.querySelector("bdi")?.textContent);
    expect(labels).toEqual(["B", "A"]);
    expect(screen.getByText(n.unsaved)).toBeInTheDocument();
  });

  it("the second save sends the version the first save returned", async () => {
    actions.saveMenuAction.mockResolvedValue({
      status: "success",
      menu: { ...footerMenu, title: "Bottom", version: 5 },
    });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(actions.saveMenuAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 4 }),
    );
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom links" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(actions.saveMenuAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Bottom links", expectedVersion: 5 }),
    );
  });

  it("a save or delete that never reaches the server shows our copy and frees the buttons", async () => {
    actions.saveMenuAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const custom: MenuDto = { ...footerMenu, id: "m-1", handle: "sale", isDefault: false };
    render(<MenuEditor t={en} locale="en" menu={custom} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: n.save })).toBeEnabled();
    expect(screen.getByLabelText(n.menuTitle)).toHaveValue("Bottom");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    actions.deleteMenuAction.mockRejectedValue(new Error("crash"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.deleteMenu }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
    expect(screen.getByRole("button", { name: n.deleteMenu })).toBeEnabled();
  });

  it("rethrows Next's redirect, so create and delete still navigate (never the 'unexpected' copy)", async () => {
    // Next's redirect() throws; the editor must let it escape run() instead of swallowing it.
    const escaped: unknown[] = [];
    const onRejection = (reason: unknown) => escaped.push(reason);
    const previous = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", onRejection);
    try {
      actions.createMenuAction.mockImplementation(async () => {
        redirect("/online-store/navigation/summer-sale");
      });
      render(<MenuEditor t={en} locale="en" menu={null} canEdit />);
      fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Sale" } });
      fireEvent.change(screen.getByLabelText(n.handle), { target: { value: "summer-sale" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: n.save }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(escaped).toHaveLength(1);
      expect((escaped[0] as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;/);
      expect(screen.queryByText(en.formErrors.unexpected)).toBeNull();
      cleanup();

      escaped.length = 0;
      vi.spyOn(window, "confirm").mockReturnValue(true);
      actions.deleteMenuAction.mockImplementation(async () => {
        redirect("/online-store/navigation");
      });
      const custom: MenuDto = { ...footerMenu, id: "m-1", handle: "sale", isDefault: false };
      render(<MenuEditor t={en} locale="en" menu={custom} canEdit />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: n.deleteMenu }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(escaped).toHaveLength(1);
      expect((escaped[0] as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;/);
      expect(screen.queryByText(en.formErrors.unexpected)).toBeNull();
    } finally {
      process.removeListener("unhandledRejection", onRejection);
      for (const listener of previous) process.on("unhandledRejection", listener);
    }
  });

  it("checks the title's length as the server measures it (normalised)", () => {
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    const title = screen.getByLabelText(n.menuTitle);
    // 100 letters and a bidi override: the server strips the override, so this fits.
    fireEvent.change(title, {
      target: { value: `${"a".repeat(100)}${String.fromCharCode(0x202e)}` },
    });
    expect(screen.queryByText(en.onlineStorePreferences.tooLong)).toBeNull();
    expect(screen.getByRole("button", { name: n.save })).toBeEnabled();
    fireEvent.change(title, { target: { value: "a".repeat(101) } });
    expect(screen.getByText(en.onlineStorePreferences.tooLong)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: n.save })).toBeDisabled();
  });

  it("ties a row's errors to its Edit button", async () => {
    actions.saveMenuAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "items.1.label": n.labelRequired },
    });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(screen.getByRole("button", { name: "Edit Terms" })).toHaveAccessibleDescription(
      n.labelRequired,
    );
  });

  it("shows the broken badge on a removed target", () => {
    render(
      <MenuEditor
        t={en}
        locale="en"
        menu={{
          ...footerMenu,
          items: [
            view(1, "Gone", { type: "collection", id: "c-9" }, { broken: true, targetTitle: null }),
          ],
        }}
        canEdit
      />,
    );
    expect(screen.getByText(n.broken)).toBeInTheDocument();
  });

  it("names targets in the admin's language: policies, home and search, never the raw type", () => {
    const menu: MenuDto = {
      ...footerMenu,
      items: [
        view(9, "Home", { type: "home" }),
        ...footerView,
        view(5, "Sale", { type: "collection", id: "c-1" }, { targetTitle: "Summer sale" }),
      ],
    };
    const { unmount } = render(<MenuEditor t={ar} locale="ar" menu={menu} canEdit />);
    expect(screen.getByText(POLICY_TITLES.terms.ar)).toBeInTheDocument();
    expect(screen.getByText(ar.onlineStoreNavigation.kinds.home)).toBeInTheDocument();
    expect(screen.getByText(ar.onlineStoreNavigation.kinds.search)).toBeInTheDocument();
    expect(screen.getByText("Summer sale")).toBeInTheDocument();
    expect(screen.queryByText("terms")).toBeNull();
    unmount();
    render(<MenuEditor t={en} locale="en" menu={menu} canEdit />);
    expect(screen.getByText(POLICY_TITLES.terms.en)).toBeInTheDocument();
  });

  it("refuses an unsafe web address inline, in the admin's language", () => {
    render(<MenuEditor t={ar} locale="ar" menu={footerMenu} canEdit />);
    openAddDialog(ar);
    fireEvent.change(screen.getByLabelText(ar.onlineStoreNavigation.labelAr), {
      target: { value: "لينك" },
    });
    fireEvent.change(screen.getByLabelText(ar.onlineStoreNavigation.link), {
      target: { value: "url" },
    });
    fireEvent.change(screen.getByLabelText(ar.onlineStoreNavigation.webAddress), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: ar.onlineStoreNavigation.done }));
    expect(screen.getByText("مسموح بلينكات https:// و mailto: و tel: بس")).toBeInTheDocument();
    // The dialog stays open and nothing was added.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stores the normalised web address, not the raw input", async () => {
    actions.saveMenuAction.mockResolvedValue({ status: "success", menu: footerMenu });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText(n.labelEn), { target: { value: "Mail" } });
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "url" } });
    fireEvent.change(screen.getByLabelText(n.webAddress), {
      target: { value: "mailto:Hi@Shop.EXAMPLE" },
    });
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    const sent = actions.saveMenuAction.mock.calls[0]?.[0] as { items: { link: unknown }[] };
    expect(sent.items[2]?.link).toEqual({ type: "url", url: "mailto:Hi@shop.example" });
  });

  it("edits an item in place (same id), and picks a collection by search, named on its row", async () => {
    actions.searchLinkTargetsAction.mockResolvedValue([
      { id: "c-1", title: "Summer sale", subtitle: "/collections/summer-sale" },
    ]);
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Find" }));
    expect(screen.getByLabelText(n.labelEn)).toHaveValue("Find");
    fireEvent.change(screen.getByLabelText(n.labelEn), { target: { value: "Sale" } });
    fireEvent.change(screen.getByLabelText(n.link), { target: { value: "collection" } });
    // Nothing picked yet: Done asks for a link.
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    expect(screen.getByText(n.invalidLink)).toBeInTheDocument();
    expect(screen.getByLabelText(n.link)).toHaveAccessibleDescription(n.invalidLink);
    expect(screen.getByLabelText(n.link)).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(await screen.findByRole("button", { name: /Summer sale/ }));
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    const row = screen.getByText("Sale").closest("li")!;
    expect(within(row).getByText("Summer sale")).toBeInTheDocument();
    actions.saveMenuAction.mockResolvedValue({ status: "success", menu: footerMenu });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    const sent = actions.saveMenuAction.mock.calls[0]?.[0] as { items: unknown[] };
    expect(sent.items[0]).toEqual({
      id: id(1),
      label: { en: "Sale" },
      link: { type: "collection", id: "c-1" },
      children: [],
    });
  });

  it("asks for a label in one language at least", () => {
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    openAddDialog();
    fireEvent.change(screen.getByLabelText(n.labelEn), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: n.done }));
    expect(screen.getByText(n.labelRequired)).toBeInTheDocument();
    for (const label of [n.labelAr, n.labelEn]) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(n.labelRequired);
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("Discard restores the saved tree; a viewer sees it read-only", () => {
    const { unmount } = render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    const row = screen.getByText("Find").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /Delete/ }));
    expect(screen.queryByText("Find")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: n.discard }));
    expect(screen.getByText("Find")).toBeInTheDocument();
    expect(screen.queryByText(n.unsaved)).toBeNull();
    unmount();

    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit={false} />);
    expect(screen.getByText(n.readOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: n.addItem })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByLabelText(n.menuTitle)).toBeDisabled();
  });

  it("a version conflict shows the reload copy and keeps the edits", async () => {
    actions.saveMenuAction.mockResolvedValue({
      status: "error",
      message: en.onlineStorePreferences.conflict,
      fieldErrors: {},
    });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStorePreferences.conflict);
    expect(screen.getByLabelText(n.menuTitle)).toHaveValue("Bottom");
    expect(screen.getByText(n.unsaved)).toBeInTheDocument();
  });

  it("shows a server field error on its item", async () => {
    actions.saveMenuAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { "items.1.label": n.labelRequired },
    });
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    const row = screen.getByText("Terms").closest("li")!;
    expect(within(row).getByText(n.labelRequired)).toBeInTheDocument();
  });

  it("checks the items with the shared validator before sending (too many items)", () => {
    const many = Array.from({ length: 31 }, (_, k) => view(k + 10, `I${k}`, { type: "home" }));
    render(<MenuEditor t={en} locale="en" menu={{ ...footerMenu, items: many }} canEdit />);
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Bottom" } });
    expect(screen.getByRole("button", { name: n.save })).toBeDisabled();
    expect(screen.getByText(n.tooMany)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: n.save })).toHaveAccessibleDescription(
      `${n.fixFirst} ${n.tooMany}`,
    );
  });

  it("a new menu checks its handle (format, not `new`) before creating it", async () => {
    actions.createMenuAction.mockResolvedValue({ status: "error", message: "x", fieldErrors: {} });
    render(<MenuEditor t={en} locale="en" menu={null} canEdit />);
    expect(screen.queryByText(n.titleRequired)).toBeNull();
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "  " } });
    expect(screen.getByText(n.titleRequired)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(n.menuTitle), { target: { value: "Sale" } });
    fireEvent.change(screen.getByLabelText(n.handle), { target: { value: "new" } });
    expect(screen.getByText(n.handleError)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: n.save })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(n.handle), { target: { value: "Summer Sale" } });
    expect(screen.getByRole("button", { name: n.save })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(n.handle), { target: { value: "summer-sale" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.save }));
    });
    expect(actions.createMenuAction).toHaveBeenCalledWith({
      handle: "summer-sale",
      title: "Sale",
      items: [],
    });
    expect(actions.saveMenuAction).not.toHaveBeenCalled();
  });

  it("deletes a custom menu after confirming; the default menus offer no delete", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    actions.deleteMenuAction.mockResolvedValue({
      status: "error",
      message: n.inUse,
      fieldErrors: {},
    });
    const custom: MenuDto = { ...footerMenu, id: "m-1", handle: "sale", isDefault: false };
    const { unmount } = render(<MenuEditor t={en} locale="en" menu={custom} canEdit />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.deleteMenu }));
    });
    await flush();
    expect(confirm).toHaveBeenCalledWith(n.confirmDelete);
    expect(actions.deleteMenuAction).toHaveBeenCalledWith("sale");
    expect(screen.getByRole("alert")).toHaveTextContent(n.inUse);
    unmount();
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    expect(screen.queryByRole("button", { name: n.deleteMenu })).toBeNull();
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const custom: MenuDto = { ...footerMenu, id: "m-1", handle: "sale", isDefault: false };
    render(<MenuEditor t={en} locale="en" menu={custom} canEdit />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: n.deleteMenu }));
    });
    expect(actions.deleteMenuAction).not.toHaveBeenCalled();
  });
});
