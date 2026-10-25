import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SubmitButton } from "./submit-button";

describe("SubmitButton", () => {
  it("is an enabled submit button with its label until the form is submitted", () => {
    render(
      <form action={async () => undefined}>
        <SubmitButton pendingLabel="Opening checkout…">Continue</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeEnabled();
  });

  it("is disabled and shows the pending label while the form action runs", async () => {
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(
      <form action={() => running}>
        <SubmitButton pendingLabel="Opening checkout…">Continue</SubmitButton>
      </form>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    const pending = screen.getByRole("button", { name: "Opening checkout…" });
    expect(pending).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    await act(async () => {
      finish();
      await running;
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
