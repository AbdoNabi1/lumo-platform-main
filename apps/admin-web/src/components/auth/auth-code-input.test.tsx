import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Label } from "@platform/ui";
import { AuthCodeInput, useAuthCode } from "./auth-code-input";

const HINT = "The 6-digit number from your app — not the setup key";
const WARNING = "This looks like the setup key. Enter the 6-digit number your app shows.";

function Harness() {
  const code = useAuthCode();
  return (
    <form>
      <Label htmlFor="c">Authentication code</Label>
      <AuthCodeInput id="c" name="code" code={code} hint={HINT} keyWarning={WARNING} required />
      <output data-testid="ready">{String(code.ready)}</output>
    </form>
  );
}

beforeEach(() => {
  expect.hasAssertions();
  cleanup();
});

describe("AuthCodeInput", () => {
  it("is a numeric one-time-code field with the 123456 placeholder and the helper line", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Authentication code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("placeholder", "123456");
    expect(input).toHaveAttribute("name", "code");
    expect(input).toBeRequired();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(HINT);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps digits only, at most six, as they are typed", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Authentication code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12 34-56789" } });
    expect(input.value).toBe("123456");
    expect(screen.getByTestId("ready")).toHaveTextContent("true");
    fireEvent.change(input, { target: { value: "123" } });
    expect(screen.getByTestId("ready")).toHaveTextContent("false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a pasted setup key shows the inline hint, leaves only its digits, and is never ready", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Authentication code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "JBSWY3DPEHPK3PXP" } });
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.value).toBe("33");
    expect(screen.getByTestId("ready")).toHaveTextContent("false");
    // Even a paste that happens to leave six digits is not submittable while it looks like the key.
    fireEvent.change(input, { target: { value: "A1B2C3D4E5F6" } });
    expect(input.value).toBe("123456");
    expect(screen.getByTestId("ready")).toHaveTextContent("false");
    // The next edit without letters clears the warning.
    fireEvent.change(input, { target: { value: "12345" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "123456" } });
    expect(screen.getByTestId("ready")).toHaveTextContent("true");
  });
});
