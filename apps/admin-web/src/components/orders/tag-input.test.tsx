import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { TagInput } from "./tag-input";

function renderInput(props: Partial<Parameters<typeof TagInput>[0]> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <TagInput
      label="Add tags"
      tags={["VIP"]}
      onAdd={onAdd}
      onRemove={onRemove}
      t={en}
      {...props}
    />,
  );
  return { onAdd, onRemove, input: screen.getByLabelText("Add tags") as HTMLInputElement };
}

describe("TagInput (order operations Part 2)", () => {
  it("adds the typed tag on Enter and clears the input", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "  urgent  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(["urgent"]);
    expect(input.value).toBe("");
  });

  it("a comma adds what came before it and keeps typing after it", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "gift, urg" } });
    expect(onAdd).toHaveBeenCalledWith(["gift"]);
    expect(input.value).toBe(" urg");
  });

  it("never re-adds a tag the order already has, in any case", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "vip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("refuses a tag over 40 characters and says why", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "x".repeat(41) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("A tag can have at most 40 characters.");
    expect(input.value).toBe("x".repeat(41));
  });

  it("splits on the Arabic comma too", () => {
    const { onAdd, input } = renderInput();
    fireEvent.change(input, { target: { value: "عاجل، هدية" } });
    expect(onAdd).toHaveBeenCalledWith(["عاجل"]);
    expect(input.value).toBe(" هدية");
  });

  it("puts user text in the remove label as typed, and isolates its direction", () => {
    renderInput({ tags: ["a$&b"] });
    expect(screen.getByRole("button", { name: "Remove a$&b" })).toBeInTheDocument();
    expect(screen.getByText("a$&b").getAttribute("dir")).toBe("auto");
  });

  it("stays focusable while a change is saving (read-only, not disabled)", () => {
    const { input } = renderInput({ disabled: true });
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
  });

  it("does not look up suggestions after it is gone", () => {
    vi.useFakeTimers();
    const suggest = vi.fn().mockResolvedValue([]);
    const { input } = renderInput({ suggest });
    fireEvent.change(input, { target: { value: "vi" } });
    cleanup();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("removes a chip with its × button", () => {
    const { onRemove } = renderInput();
    fireEvent.click(screen.getByRole("button", { name: "Remove VIP" }));
    expect(onRemove).toHaveBeenCalledWith("VIP");
  });

  it("offers the shop's tags while typing, leaving out ones already on the order", async () => {
    const suggest = vi.fn().mockResolvedValue(["VIP", "Village"]);
    const { onAdd, input } = renderInput({ suggest });
    fireEvent.change(input, { target: { value: "vi" } });
    fireEvent.click(await screen.findByRole("button", { name: "Village" }));
    expect(suggest).toHaveBeenCalledWith("vi");
    expect(screen.queryByRole("button", { name: "VIP" })).toBeNull();
    expect(onAdd).toHaveBeenCalledWith(["Village"]);
  });

  it("speaks Arabic on an Arabic page and lays out with logical spacing only", () => {
    render(
      <TagInput label="إضافة علامات" tags={["عاجل"]} onAdd={vi.fn()} onRemove={vi.fn()} t={ar} />,
    );
    const remove = screen.getByRole("button", { name: "إزالة عاجل" });
    expect(remove.className).not.toMatch(/\b(ml|mr|pl|pr)-/);
  });
});
