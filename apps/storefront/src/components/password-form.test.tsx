import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

vi.mock("@/app/(gate)/password/actions", () => ({ unlockAction: vi.fn() }));
const { PasswordFormView } = await import("./password-form");

describe("PasswordFormView", () => {
  it("labels the field and the button, and keeps return_to hidden", () => {
    render(
      <PasswordFormView
        t={ar}
        locale="ar"
        returnTo="/cart"
        state={{ status: "idle" }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByLabelText("كلمة المرور")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "دخول" })).toBeInTheDocument();
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/cart");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the incorrect and rate-limited messages, the minutes formatted for the locale", () => {
    const { rerender } = render(
      <PasswordFormView
        t={en}
        locale="en"
        returnTo="/"
        state={{ status: "incorrect" }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password");
    rerender(
      <PasswordFormView
        t={ar}
        locale="ar"
        returnTo="/"
        state={{ status: "rate_limited", minutes: 2 }}
        action={() => undefined}
        pending={false}
      />,
    );
    // Arabic dual: "two minutes" is one word.
    expect(screen.getByRole("alert")).toHaveTextContent("بعد دقيقتين.");
  });

  // Arabic counts agree with the number: 1 and 2 are words, 3–10 take the plural, 11–99 the
  // singular accusative, 100–102 the singular. Preflight 14: digits depend on the ICU data.
  it.each([
    [1, "بعد دقيقة واحدة."],
    [2, "بعد دقيقتين."],
    [3, `بعد ${new Intl.NumberFormat("ar").format(3)} دقائق.`],
    [10, `بعد ${new Intl.NumberFormat("ar").format(10)} دقائق.`],
    [11, `بعد ${new Intl.NumberFormat("ar").format(11)} دقيقة.`],
    [59, `بعد ${new Intl.NumberFormat("ar").format(59)} دقيقة.`],
    [100, `بعد ${new Intl.NumberFormat("ar").format(100)} دقيقة.`],
  ])("Arabic: %i minute(s) → %s", (minutes, expected) => {
    render(
      <PasswordFormView
        t={ar}
        locale="ar"
        returnTo="/"
        state={{ status: "rate_limited", minutes }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("alert").textContent).not.toContain("{");
  });

  it.each([
    [1, "Try again in one minute."],
    [2, "Try again in 2 minutes."],
    [11, "Try again in 11 minutes."],
  ])("English: %i minute(s) → %s", (minutes, expected) => {
    render(
      <PasswordFormView
        t={en}
        locale="en"
        returnTo="/"
        state={{ status: "rate_limited", minutes }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(expected);
  });

  it("words the shared rate limit neutrally: the visitor may have done nothing wrong (Ruling 5)", () => {
    render(
      <PasswordFormView
        t={en}
        locale="en"
        returnTo="/"
        state={{ status: "rate_limited", minutes: 3 }}
        action={() => undefined}
        pending={false}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts on this store. Try again in 3 minutes.");
    expect(alert.textContent).not.toMatch(/\byou(r)?\b/i);
    expect(ar.password.tooMany).toContain("على هذا المتجر");
  });

  it("says 'temporarily unavailable' for an unavailable answer", () => {
    render(
      <PasswordFormView
        t={en}
        locale="en"
        returnTo="/"
        state={{ status: "unavailable" }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(en.password.unavailable);
    expect(screen.getByLabelText(en.password.label)).toHaveAttribute("aria-invalid", "true");
  });
});
