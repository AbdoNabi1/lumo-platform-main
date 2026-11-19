import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions", () => ({ setLocale: vi.fn() }));
const { LocaleSwitch } = await import("./locale-switch");
const { PreviewModeProvider } = await import("./preview-mode");

describe("LocaleSwitch (Ruling 15)", () => {
  it("is usable on an ordinary visit", () => {
    render(<LocaleSwitch locale="ar" label="Language" />);
    expect(screen.getByRole("button", { name: "Language" })).toBeEnabled();
  });

  it("is disabled when told so, and inside any preview (a language change is a write)", () => {
    const { unmount } = render(<LocaleSwitch locale="ar" label="Language" disabled />);
    expect(screen.getByRole("button", { name: "Language" })).toBeDisabled();
    unmount();
    render(
      <PreviewModeProvider token="tok">
        <LocaleSwitch locale="ar" label="Language" />
      </PreviewModeProvider>,
    );
    expect(screen.getByRole("button", { name: "Language" })).toBeDisabled();
  });
});
