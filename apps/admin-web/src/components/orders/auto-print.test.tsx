import { describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { AutoPrint } from "./auto-print";

describe("AutoPrint", () => {
  it("opens the print dialog exactly once, even under StrictMode's double effects", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(
      <StrictMode>
        <AutoPrint />
      </StrictMode>,
    );
    expect(print).toHaveBeenCalledTimes(1);
  });
});
