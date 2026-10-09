import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OptionsEditor } from "./options-editor";

const t = en.productEditor;

function setup(initial: { name: string; values: string[] }[] = []) {
  const onChange = vi.fn();
  const view = render(<OptionsEditor initial={initial} onChange={onChange} t={en} />);
  return { onChange, ...view };
}

const valueInputs = () => screen.getAllByLabelText(t.optionValue);

describe("OptionsEditor", () => {
  it("opens a new option in editing state with suggestions and one empty value", () => {
    const { container } = setup();

    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));

    const name = screen.getByLabelText(t.optionName);
    const list = container.querySelector("datalist");
    expect(list).not.toBeNull();
    expect(name).toHaveAttribute("list", list!.id);
    expect(Array.from(list!.querySelectorAll("option")).map((option) => option.value)).toEqual([
      ...t.optionSuggestions,
    ]);
    expect(valueInputs()).toHaveLength(1);
    expect(valueInputs()[0]).toHaveValue("");
  });

  it("appends an empty value as you type, and reports only the filled ones", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));
    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });

    fireEvent.change(valueInputs()[0]!, { target: { value: "S" } });
    expect(valueInputs()).toHaveLength(2);
    fireEvent.change(valueInputs()[1]!, { target: { value: "M" } });
    expect(valueInputs()).toHaveLength(3);

    // Clearing a middle value keeps its place; blanks never reach the form's options.
    fireEvent.change(valueInputs()[1]!, { target: { value: "" } });
    expect(valueInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["S", "", ""]);
    expect(onChange).toHaveBeenLastCalledWith([{ name: "Size", values: ["S"] }]);
  });

  it("removes one value with its own button", () => {
    const { onChange } = setup([{ name: "Size", values: ["S", "M"] }]);
    fireEvent.click(screen.getByRole("button", { name: t.edit }));

    fireEvent.click(screen.getByRole("button", { name: t.removeValue.replace("{value}", "S") }));

    expect(valueInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["M", ""]);
    expect(onChange).toHaveBeenLastCalledWith([{ name: "Size", values: ["M"] }]);
  });

  it("collapses to chips on Done, and Done waits for a name and a value", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));
    const done = screen.getByRole("button", { name: t.done });
    expect(done).toBeDisabled();

    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: "Size" } });
    expect(done).toBeDisabled();
    fireEvent.change(valueInputs()[0]!, { target: { value: "S" } });
    expect(done).toBeEnabled();

    fireEvent.click(done);

    expect(screen.queryByLabelText(t.optionName)).not.toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.edit })).toBeInTheDocument();
  });

  it("still submits a collapsed option, through hidden inputs joined to the page form", () => {
    const { container } = setup([{ name: "Size", values: ["S", "M"] }]);

    const name = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="optionName-0"]',
    );
    const values = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="optionValue-0"]'),
    );
    expect(name?.value).toBe("Size");
    expect(name).toHaveAttribute("form", "product-editor");
    expect(values.map((input) => input.value)).toEqual(["S", "M"]);
    expect(values[0]).toHaveAttribute("form", "product-editor");
  });

  it("submits an option being edited through its own inputs, joined to the page form", () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));

    expect(screen.getByLabelText(t.optionName)).toHaveAttribute("name", "optionName-0");
    expect(screen.getByLabelText(t.optionName)).toHaveAttribute("form", "product-editor");
    expect(valueInputs()[0]).toHaveAttribute("name", "optionValue-0");
    expect(valueInputs()[0]).toHaveAttribute("form", "product-editor");
    expect(container.querySelector('input[type="hidden"][name="optionName-0"]')).toBeNull();
  });

  it("deletes an option, and stops adding at three", () => {
    const { onChange } = setup([
      { name: "A", values: ["1"] },
      { name: "B", values: ["1"] },
    ]);
    const add = screen.getByRole("button", { name: t.addAnotherOption });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(screen.getByRole("button", { name: t.addAnotherOption })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: t.deleteOption }));

    expect(screen.getByRole("button", { name: t.addAnotherOption })).toBeEnabled();
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "A", values: ["1"] },
      { name: "B", values: ["1"] },
    ]);
  });

  it("does not submit the page when Enter is pressed in a value", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: t.addOptions }));

    const notPrevented = fireEvent.keyDown(valueInputs()[0]!, { key: "Enter" });

    expect(notPrevented).toBe(false);
  });

  it("merges a second option with an existing name into the first on Done", () => {
    const { onChange, container } = setup([{ name: "Size", values: ["29"] }]);
    fireEvent.click(screen.getByRole("button", { name: t.addAnotherOption }));
    fireEvent.change(screen.getByLabelText(t.optionName), { target: { value: " size " } });
    fireEvent.change(valueInputs()[0]!, { target: { value: "22" } });

    expect(screen.getByText(t.mergesIntoOption.replace("{name}", "Size"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t.done }));

    expect(onChange).toHaveBeenLastCalledWith([{ name: "Size", values: ["29", "22"] }]);
    const names = container.querySelectorAll('input[name^="optionName-"]');
    expect(names).toHaveLength(1);
  });

  it("offers an add-value button on a folded option", () => {
    setup([{ name: "Size", values: ["S"] }]);

    fireEvent.click(screen.getByRole("button", { name: t.addValue.replace("{name}", "Size") }));

    expect(screen.getByLabelText(t.optionName)).toHaveValue("Size");
    expect(valueInputs().at(-1)).toHaveFocus();
  });

  it("tells the merchant to add a value, not a new option, for another size", () => {
    setup([{ name: "Size", values: ["29"] }]);

    expect(
      screen.getByRole("button", { name: t.addValue.replace("{name}", "Size") }),
    ).toHaveTextContent(t.addValueShort);
    fireEvent.click(screen.getByRole("button", { name: t.addAnotherOption }));

    expect(screen.getByText(t.newOptionHint)).toBeInTheDocument();
  });
});
