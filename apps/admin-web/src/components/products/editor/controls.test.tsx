import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Chip, ChipPanel, ChipRow, MoneyInput, StatusPicker, Switch, TagsInput } from "./controls";

function formDataOf(container: HTMLElement): FormData {
  const form = container.querySelector("form");
  if (form === null) throw new Error("no form rendered");
  return new FormData(form);
}

describe("Switch", () => {
  it("has the switch role and a label, toggles, and posts 'on' only while on", () => {
    const { container } = render(
      <form>
        <Switch name="taxable" label="Charge tax" />
      </form>,
    );

    const toggle = screen.getByRole("switch", { name: "Charge tax" });
    expect(toggle).not.toBeChecked();
    expect(formDataOf(container).get("taxable")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(formDataOf(container).get("taxable")).toBe("on");

    fireEvent.click(toggle);
    expect(formDataOf(container).get("taxable")).toBeNull();
  });

  it("reports the new state through onCheckedChange and honours defaultChecked", () => {
    const seen: boolean[] = [];
    render(
      <Switch
        name="x"
        label="Physical"
        defaultChecked
        onCheckedChange={(checked) => seen.push(checked)}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Physical" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(seen).toEqual([false]);
  });
});

function ChipHarness() {
  const [open, setOpen] = useState(false);
  return (
    <form>
      <ChipRow>
        <Chip
          label="Compare-at"
          value="$10.00"
          expanded={open}
          onToggle={() => setOpen((current) => !current)}
          controls="compare-panel"
        />
      </ChipRow>
      <ChipPanel id="compare-panel" open={open}>
        <input name="compareAtPrice" defaultValue="10.00" aria-label="Compare-at input" />
      </ChipPanel>
    </form>
  );
}

describe("Chip", () => {
  it("keeps the panel mounted and hidden until clicked, and still submits its input", () => {
    const { container } = render(<ChipHarness />);

    const chip = screen.getByRole("button", { name: /Compare-at/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(chip).toHaveAttribute("aria-controls", "compare-panel");
    expect(chip).toHaveTextContent("Compare-at · $10.00");
    const panel = container.querySelector("#compare-panel");
    expect(panel).toHaveAttribute("hidden");
    expect(formDataOf(container).get("compareAtPrice")).toBe("10.00");

    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(formDataOf(container).get("compareAtPrice")).toBe("10.00");
  });

  it("renders only the label when it has no value", () => {
    render(<Chip label="Cost per item" expanded={false} onToggle={() => undefined} controls="c" />);

    expect(screen.getByRole("button")).toHaveTextContent(/^Cost per item$/);
  });
});

function currencySymbol(locale: string, currency: string): string | undefined {
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value;
}

describe("MoneyInput", () => {
  it.each([
    ["EGP", "ar"],
    ["USD", "en"],
  ])("shows the %s symbol for the %s locale as a prefix", (currency, locale) => {
    render(
      <MoneyInput
        name="price"
        label="Price"
        currency={currency}
        locale={locale}
        value="5"
        onValueChange={() => undefined}
      />,
    );

    const symbol = currencySymbol(locale, currency);
    expect(symbol).toBeDefined();
    expect(screen.getByText(symbol!)).toBeInTheDocument();
    expect(screen.getByLabelText("Price")).toHaveAttribute("name", "price");
    expect(screen.getByLabelText("Price")).toHaveAttribute("inputmode", "decimal");
  });

  it("shows $ for USD in English and reports typing", () => {
    const seen: string[] = [];
    render(
      <MoneyInput
        name="price"
        label="Price"
        currency="USD"
        locale="en"
        value="5"
        onValueChange={(value) => seen.push(value)}
        form="product-editor"
      />,
    );

    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByLabelText("Price")).toHaveAttribute("form", "product-editor");
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "7.5" } });
    expect(seen).toEqual(["7.5"]);
  });
});

function tagInput(): HTMLInputElement {
  return screen.getByLabelText("Tags") as HTMLInputElement;
}

function hiddenTags(container: HTMLElement): string {
  const hidden = container.querySelector('input[type="hidden"][name="tags"]');
  if (hidden === null) throw new Error("no hidden tags input");
  return (hidden as HTMLInputElement).value;
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("TagsInput", () => {
  const props = { name: "tags", label: "Tags", removeLabel: "Remove {tag}" } as const;

  it("adds a chip on Enter or a comma and keeps one comma-joined hidden value", () => {
    const { container } = render(<TagsInput {...props} defaultTags={[]} form="product-editor" />);

    type(tagInput(), "summer");
    fireEvent.keyDown(tagInput(), { key: "Enter" });
    type(tagInput(), "sale,");

    expect(screen.getByText("summer")).toBeInTheDocument();
    expect(screen.getByText("sale")).toBeInTheDocument();
    expect(hiddenTags(container)).toBe("summer, sale");
    expect(container.querySelector('input[type="hidden"][name="tags"]')).toHaveAttribute(
      "form",
      "product-editor",
    );
    expect(tagInput()).toHaveValue("");
  });

  it("never submits the page on Enter", () => {
    render(<TagsInput {...props} defaultTags={[]} />);

    type(tagInput(), "x");
    const notPrevented = fireEvent.keyDown(tagInput(), { key: "Enter" });

    expect(notPrevented).toBe(false);
  });

  it("removes the last chip on Backspace in an empty input", () => {
    const { container } = render(<TagsInput {...props} defaultTags={["summer", "sale"]} />);

    fireEvent.keyDown(tagInput(), { key: "Backspace" });

    expect(screen.queryByText("sale")).not.toBeInTheDocument();
    expect(hiddenTags(container)).toBe("summer");
  });

  it("does not remove a chip on Backspace while there is text", () => {
    const { container } = render(<TagsInput {...props} defaultTags={["summer"]} />);

    type(tagInput(), "x");
    fireEvent.keyDown(tagInput(), { key: "Backspace" });

    expect(hiddenTags(container)).toBe("summer");
  });

  it("accepts the Arabic comma", () => {
    const { container } = render(<TagsInput {...props} defaultTags={[]} />);

    type(tagInput(), "أ،");

    expect(screen.getByText("أ")).toBeInTheDocument();
    expect(hiddenTags(container)).toBe("أ");
  });

  it("ignores duplicates, case-insensitively", () => {
    const { container } = render(<TagsInput {...props} defaultTags={["Summer"]} />);

    type(tagInput(), "summer,");
    type(tagInput(), "SUMMER");
    fireEvent.keyDown(tagInput(), { key: "Enter" });

    expect(hiddenTags(container)).toBe("Summer");
  });

  it("removes a chip with its ✕ button, labelled with the tag", () => {
    const { container } = render(<TagsInput {...props} defaultTags={["summer", "sale"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove summer" }));

    expect(hiddenTags(container)).toBe("sale");
  });

  it("adds a half-typed tag when the input loses focus", () => {
    const { container } = render(<TagsInput {...props} defaultTags={[]} />);

    type(tagInput(), "pending");
    fireEvent.blur(tagInput());

    expect(hiddenTags(container)).toBe("pending");
  });
});

const STATUS_OPTIONS = [
  { value: "published", label: "Active", description: "Sold and shown" },
  { value: "draft", label: "Draft", description: "Hidden" },
  { value: "unlisted", label: "Unlisted", description: "Direct link only" },
];

function renderPicker() {
  return render(
    <form id="product-editor">
      <StatusPicker
        name="status"
        label="Status"
        value="draft"
        options={STATUS_OPTIONS}
        form="product-editor"
      />
    </form>,
  );
}

function openPicker(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: /^Status/ }), { key: "Enter" });
}

describe("StatusPicker", () => {
  it("shows the current label on the trigger and posts the current value", () => {
    const { container } = renderPicker();

    expect(screen.getByRole("button", { name: /^Status/ })).toHaveTextContent("Draft");
    expect(formDataOf(container).get("status")).toBe("draft");
  });

  it("lists every option with its description and marks the current one", async () => {
    renderPicker();
    openPicker();

    const items = await screen.findAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    for (const option of STATUS_OPTIONS) {
      expect(screen.getByText(option.description)).toBeInTheDocument();
    }
    const checked = items.filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(within(checked[0]!).getByText("Draft")).toBeInTheDocument();
  });

  it("updates the trigger, the hidden input and onChange when an option is chosen", async () => {
    const seen: string[] = [];
    const { container } = render(
      <form>
        <StatusPicker
          name="status"
          label="Status"
          value="draft"
          options={STATUS_OPTIONS}
          onChange={(value) => seen.push(value)}
        />
      </form>,
    );
    openPicker();

    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Unlisted/ }));

    expect(screen.getByRole("button", { name: /^Status/ })).toHaveTextContent("Unlisted");
    expect(formDataOf(container).get("status")).toBe("unlisted");
    expect(seen).toEqual(["unlisted"]);
  });
});
