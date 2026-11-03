import { describe, expect, it } from "vitest";
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
