import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyLinkButton } from "./copy-link-button";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyLinkButton", () => {
  it("copies the https link of the hostname and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLinkButton hostname="shop.morbeh.test" label="Copy link" copiedLabel="Copied" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://shop.morbeh.test"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("does not claim success when the clipboard is unavailable", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLinkButton hostname="shop.morbeh.test" label="Copy link" copiedLabel="Copied" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
