import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { OptionNamePicker } from "./option-name-picker";

const t = en.productEditor;

function setup(
  used: string[] = [],
  dictionary: Dictionary = en,
  triggerLabel: string = en.productEditor.addOptions,
) {
  const onPick = vi.fn();
  render(
    <div>
      <button type="button">outside</button>
      <OptionNamePicker used={used} onPick={onPick} t={dictionary} triggerLabel={triggerLabel} />
    </div>,
  );
  return { onPick };
}

const trigger = (label = t.addOptions) => screen.getByRole("button", { name: label });
const open = (label = t.addOptions) => fireEvent.click(trigger(label));
const panel = () => screen.getByRole("dialog", { name: t.addOptions });

describe("OptionNamePicker", () => {
  it("opens a labelled panel with a search box, a Recommended heading and Create custom option", () => {
    setup();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(within(panel()).getByLabelText(t.searchOptions)).toBeInTheDocument();
    expect(within(panel()).getByText(t.recommended)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: t.createCustomOption })).toBeInTheDocument();
  });

  it("puts the cursor in the search box when it opens", () => {
    setup();

    open();

    expect(within(panel()).getByLabelText(t.searchOptions)).toHaveFocus();
  });

  it("lists every recommended option that is not already used, ignoring case and spaces", () => {
    setup([" size ", "COLOR"]);
    open();

    const names = within(panel())
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual([
      ...t.recommendedOptions.filter((name) => !["Size", "Color"].includes(name)),
      t.createCustomOption,
    ]);
  });

  it("filters the list as you type", () => {
    setup();
    open();

    fireEvent.change(within(panel()).getByLabelText(t.searchOptions), { target: { value: "col" } });

    const names = within(panel())
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["Color", t.createCustomOption]);
  });

  it("picking a recommended option hands over its name and closes", () => {
    const { onPick } = setup();
    open();

    fireEvent.click(within(panel()).getByRole("button", { name: "Color" }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("Color");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Create custom option uses what was typed, or nothing", () => {
    const { onPick } = setup();
    open();
    fireEvent.change(within(panel()).getByLabelText(t.searchOptions), {
      target: { value: "  Fabric " },
    });
    fireEvent.click(within(panel()).getByRole("button", { name: t.createCustomOption }));
    expect(onPick).toHaveBeenLastCalledWith("Fabric");

    open();
    fireEvent.click(within(panel()).getByRole("button", { name: t.createCustomOption }));
    expect(onPick).toHaveBeenLastCalledWith("");
  });

  it("starts the next search empty", () => {
    setup();
    open();
    fireEvent.change(within(panel()).getByLabelText(t.searchOptions), { target: { value: "zz" } });
    fireEvent.click(within(panel()).getByRole("button", { name: t.createCustomOption }));

    open();

    expect(within(panel()).getByLabelText(t.searchOptions)).toHaveValue("");
  });

  it("Escape closes the panel and gives the focus back to the button", () => {
    const { onPick } = setup();
    open();

    fireEvent.keyDown(within(panel()).getByLabelText(t.searchOptions), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a press outside closes the panel and gives the focus back to the button", () => {
    setup();
    open();

    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("a press inside the panel leaves it open", () => {
    setup();
    open();

    fireEvent.pointerDown(within(panel()).getByText(t.recommended));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not submit the page when Enter is pressed in the search box", () => {
    setup();
    open();

    const notPrevented = fireEvent.keyDown(within(panel()).getByLabelText(t.searchOptions), {
      key: "Enter",
    });

    expect(notPrevented).toBe(false);
  });

  it("speaks Arabic from the dictionary it is given", () => {
    setup([], ar, ar.productEditor.addOptions);
    fireEvent.click(screen.getByRole("button", { name: ar.productEditor.addOptions }));

    const dialog = screen.getByRole("dialog", { name: ar.productEditor.addOptions });
    expect(within(dialog).getByText(ar.productEditor.recommended)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "المقاس" })).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: ar.productEditor.createCustomOption }),
    ).toBeInTheDocument();
  });

  it("opens from the left edge in either direction (logical start, not left)", () => {
    setup();
    open();

    expect(panel().className).toContain("start-0");
    expect(panel().className).not.toMatch(/\b(left|right)-/);
  });
});
