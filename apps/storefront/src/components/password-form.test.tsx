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
    // Preflight 14: the digits depend on the ICU data, so compute them the same way.
    expect(screen.getByRole("alert")).toHaveTextContent(
      `بعد ${new Intl.NumberFormat("ar").format(2)} دقائق`,
    );
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
