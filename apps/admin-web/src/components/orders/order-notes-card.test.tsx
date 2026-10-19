import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderNotesCard } from "./order-notes-card";

const actions = vi.hoisted(() => ({
  saveOrderNoteAction: vi.fn(),
  changeOrderTagsAction: vi.fn(),
  suggestOrderTagsAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

beforeEach(() => {
  actions.saveOrderNoteAction.mockReset().mockResolvedValue({ status: "success" });
});

describe("OrderNotesCard (Shopify's Notes card)", () => {
  it('says "No notes" when there is none, and shows the note with its line breaks when there is', () => {
    const { rerender } = render(<OrderNotesCard orderId="o-1" note={null} canEdit t={en} />);
    expect(screen.getByText("No notes")).toBeInTheDocument();
    rerender(<OrderNotesCard orderId="o-1" note={"Ring twice\nLeave at door"} canEdit t={en} />);
    expect(screen.getByText(/Ring twice/).className).toContain("whitespace-pre-wrap");
    expect(screen.getByText(/Ring twice/).getAttribute("dir")).toBe("auto");
  });

  it("offers no pencil to someone who may not edit notes", () => {
    render(<OrderNotesCard orderId="o-1" note={null} canEdit={false} t={en} />);
    expect(screen.queryByRole("button", { name: "Edit notes" })).toBeNull();
  });

  it("edits in a dialog prefilled with the note, saves through the action and closes", async () => {
    render(<OrderNotesCard orderId="o-1" note="Ring twice" canEdit t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    const textarea = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Ring twice");
    fireEvent.change(textarea, { target: { value: "Call first" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.saveOrderNoteAction).toHaveBeenCalled());
    const formData = actions.saveOrderNoteAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("orderId")).toBe("o-1");
    expect(formData.get("note")).toBe("Call first");
    await waitFor(() => expect(screen.queryByLabelText("Note")).toBeNull());
  });

  it("shows the refusal in the dialog", async () => {
    actions.saveOrderNoteAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { note: "Notes can have at most 5,000 characters." },
    });
    render(<OrderNotesCard orderId="o-1" note={null} canEdit t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Notes can have at most 5,000 characters.")).toBeInTheDocument();
  });

  it("shows a character counter and says when the note is too long, without calling the action", async () => {
    render(<OrderNotesCard orderId="o-1" note="abc" canEdit t={en} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    expect(screen.getByText("3 / 5,000")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "a".repeat(5001) } });
    expect(screen.getByText("5,001 / 5,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Notes can have at most 5,000 characters.")).toBeInTheDocument();
    expect(actions.saveOrderNoteAction).not.toHaveBeenCalled();
  });

  it("is in Arabic on an Arabic page", () => {
    render(<OrderNotesCard orderId="o-1" note={null} canEdit t={ar} />);
    expect(screen.getByText("ملاحظات")).toBeInTheDocument();
    expect(screen.getByText("لا توجد ملاحظات")).toBeInTheDocument();
  });
});
