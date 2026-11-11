import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { LocalizedTextField } from "./localized-text-field";

const p = en.onlineStorePreferences;

function field(value: { ar?: string; en?: string }, errors: Record<string, string> = {}) {
  return (
    <LocalizedTextField
      t={en}
      locale="en"
      name="homeTitle"
      label="Title"
      max={70}
      value={value}
      errors={errors}
    />
  );
}

describe("LocalizedTextField", () => {
  it("is a complete tabs pattern: each tab controls its own panel, and only one panel shows", () => {
    render(field({ ar: "متجر", en: "Shop" }));
    const arTab = screen.getByRole("tab", { name: p.arabic });
    const enTab = screen.getByRole("tab", { name: p.english });
    const arPanel = document.getElementById(arTab.getAttribute("aria-controls") ?? "");
    const enPanel = document.getElementById(enTab.getAttribute("aria-controls") ?? "");
    expect(arPanel).toHaveAttribute("role", "tabpanel");
    expect(enPanel).toHaveAttribute("role", "tabpanel");
    expect(arPanel).toHaveAttribute("aria-labelledby", arTab.id);
    expect(arPanel).not.toHaveAttribute("hidden");
    expect(enPanel).toHaveAttribute("hidden");
    fireEvent.click(enTab);
    expect(enTab).toHaveAttribute("aria-selected", "true");
    expect(enPanel).not.toHaveAttribute("hidden");
    expect(arPanel).toHaveAttribute("hidden");
  });

  it("both languages always submit, even the hidden one", () => {
    const { container } = render(field({ ar: "متجر", en: "Shop" }));
    expect(container.querySelector('[name="homeTitle.ar"]')).toHaveValue("متجر");
    expect(container.querySelector('[name="homeTitle.en"]')).toHaveValue("Shop");
  });

  it("follows a fresh value from the server (a refresh after another save)", () => {
    const { container, rerender } = render(field({ ar: "قديم" }));
    rerender(field({ ar: "جديد", en: "New" }));
    expect(container.querySelector('[name="homeTitle.ar"]')).toHaveValue("جديد");
    expect(container.querySelector('[name="homeTitle.en"]')).toHaveValue("New");
  });

  it("keeps what the merchant typed while the server value is unchanged", () => {
    const value = { ar: "قديم" };
    const { container, rerender } = render(field(value));
    fireEvent.change(container.querySelector('[name="homeTitle.ar"]')!, {
      target: { value: "مكتوب" },
    });
    rerender(field({ ar: "قديم" }));
    expect(container.querySelector('[name="homeTitle.ar"]')).toHaveValue("مكتوب");
  });

  it("marks the language with an error, and shows the message", () => {
    render(field({}, { "homeTitle.en": p.tooLong }));
    expect(screen.getByRole("tab", { name: p.english })).toHaveClass("text-destructive");
    fireEvent.click(screen.getByRole("tab", { name: p.english }));
    expect(screen.getByText(p.tooLong)).toBeInTheDocument();
  });
});

describe("LocalizedTextField layout", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const both = (
    value: { ar?: string; en?: string },
    errors: Record<string, string> = {},
    onChange?: (v: { ar?: string; en?: string }) => void,
  ) => (
    <LocalizedTextField
      t={en}
      locale="en"
      name="s.heading"
      label="Heading"
      max={80}
      layout="both"
      value={value}
      errors={errors}
      {...(onChange === undefined ? {} : { onChange })}
    />
  );

  it("both shows each language with its own label, input, counter and error at once", () => {
    render(both({ ar: "أهلا", en: "Hi" }, { "s.heading.ar": "ar-bad", "s.heading.en": "en-bad" }));
    expect(screen.queryByRole("tab")).toBeNull();
    const arInput = screen.getByLabelText(`Heading (${p.arabic})`);
    const enInput = screen.getByLabelText(`Heading (${p.english})`);
    expect(arInput).toBeVisible();
    expect(enInput).toBeVisible();
    expect(arInput).toHaveValue("أهلا");
    expect(screen.getByText("4/80")).toBeInTheDocument();
    expect(screen.getByText("2/80")).toBeInTheDocument();
    expect(arInput).toHaveAccessibleDescription(/ar-bad/);
    expect(enInput).toHaveAccessibleDescription(/en-bad/);
    expect(arInput.getAttribute("aria-describedby")).not.toBe(
      enInput.getAttribute("aria-describedby"),
    );
  });

  it("both reports edits per language", () => {
    const onChange = vi.fn();
    render(both({ ar: "أ" }, {}, onChange));
    fireEvent.change(screen.getByLabelText(`Heading (${p.english})`), { target: { value: "x" } });
    expect(onChange).toHaveBeenLastCalledWith({ ar: "أ", en: "x" });
  });

  it("tabs (the default) is unchanged: one panel shows and one counter", () => {
    render(field({ ar: "متجر", en: "Shop" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getAllByText(/\/70/)).toHaveLength(1);
  });
});
