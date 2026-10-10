import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton } from "./copy-button";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderButton() {
  render(
    <CopyButton
      text="mona@example.com"
      label="Copy"
      copiedLabel="Copied"
      ariaLabel="Copy email address"
    />,
  );
  return screen.getByRole("button", { name: "Copy email address" });
}

describe("CopyButton", () => {
  it("has an accessible name that says what is copied", () => {
    expect(renderButton()).toHaveTextContent("Copy");
  });

  it("writes the text to the clipboard and says Copied", async () => {
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith("mona@example.com");
    expect(button).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("goes back to Copy after two seconds, not before", async () => {
    const button = renderButton();
    await act(async () => {
      fireEvent.click(button);
    });

    await act(async () => {
      vi.advanceTimersByTime(1900);
    });
    expect(button).toHaveTextContent("Copied");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(button).toHaveTextContent("Copy");
    expect(button).not.toHaveTextContent("Copied");
  });

  it("does not claim a copy the browser refused", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toHaveTextContent("Copy");
    expect(button).not.toHaveTextContent("Copied");
  });
});
