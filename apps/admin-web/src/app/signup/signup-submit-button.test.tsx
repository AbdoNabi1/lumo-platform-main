import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignupSubmitButton } from "./signup-submit-button";

afterEach(cleanup);

function renderInForm() {
  const { container } = render(
    <form action="/auth/signup" method="post">
      <SignupSubmitButton pendingLabel="Creating…">Create store</SignupSubmitButton>
    </form>,
  );
  return container.querySelector("form")!;
}

describe("SignupSubmitButton", () => {
  it("is enabled until the form is submitted", () => {
    renderInForm();
    expect(screen.getByRole("button", { name: "Create store" })).toBeEnabled();
  });

  it("disables itself and says it is working once the form submits, so it can't double-submit", () => {
    const form = renderInForm();
    act(() => {
      fireEvent.submit(form);
    });
    const button = screen.getByRole("button", { name: /Creating…/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("re-enables when the page comes back from the back/forward cache", () => {
    const form = renderInForm();
    act(() => {
      fireEvent.submit(form);
    });
    act(() => {
      const event = new Event("pageshow") as Event & { persisted?: boolean };
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    expect(screen.getByRole("button", { name: "Create store" })).toBeEnabled();
  });
});
