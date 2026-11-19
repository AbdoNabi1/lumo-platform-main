import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorField } from "./color-field";
import { NativeSelect } from "./native-select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

describe("form controls (Project 4)", () => {
  it("Switch is a checkbox with the switch role and reports changes", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Lock" checked={false} onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Lock" });
    expect(control).toHaveAttribute("type", "checkbox");
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("ColorField normalises #RRGGBB / RRGGBB to lower case and refuses anything else", () => {
    const onChange = vi.fn();
    render(
      <ColorField id="c" label="Primary" textLabel="Hex" value="#635bff" onChange={onChange} />,
    );
    const text = screen.getByLabelText("Hex");
    fireEvent.change(text, { target: { value: "AABBCC" } });
    fireEvent.blur(text);
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
    fireEvent.change(text, { target: { value: "red" } });
    fireEvent.blur(text);
    expect(text).toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Primary"), { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("NativeSelect and Textarea are the native elements", () => {
    render(
      <>
        <NativeSelect aria-label="Font" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </NativeSelect>
        <Textarea aria-label="Note" defaultValue="x" />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Font" })).toHaveValue("b");
    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe("TEXTAREA");
  });
});
