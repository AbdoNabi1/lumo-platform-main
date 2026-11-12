import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { en } from "@/messages/en";
import { OrderCommentItem } from "./order-comment-item";

const actions = vi.hoisted(() => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));
vi.mock("@/app/orders/annotation-actions", () => actions);

function comment(overrides: Partial<TimelineEntryDto> = {}): TimelineEntryDto {
  return {
    id: "e-1",
    kind: "comment",
    authorName: "Mona",
    body: "Called — no answer",
    data: {},
    createdAt: "2026-10-19T09:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function renderItem(entry: TimelineEntryDto) {
  render(
    <ol>
      <OrderCommentItem orderId="o-1" entry={entry} t={en} locale="en" />
    </ol>,
  );
}

beforeEach(() => {
  actions.editOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
  actions.deleteOrderCommentAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderCommentItem", () => {
  it("shows the text, the author and Edited, with no buttons it may not use", () => {
    renderItem(comment({ editedAt: "2026-10-19T10:00:00.000Z", canEdit: false, canDelete: false }));
    expect(screen.getByText("Called — no answer")).toBeInTheDocument();
    expect(screen.getByText(/Mona/)).toHaveTextContent("Edited");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("writes staff text with dir=auto so Arabic and English comments each read correctly", () => {
    renderItem(comment({ body: "اتصلت بالعميل" }));
    expect(screen.getByText("اتصلت بالعميل")).toHaveAttribute("dir", "auto");
  });

  it("edits in place: Save sends the entry id and new text, and closes on success", async () => {
    renderItem(comment());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Comment") as HTMLTextAreaElement;
    expect(box.value).toBe("Called — no answer");
    fireEvent.change(box, { target: { value: "Called twice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.editOrderCommentAction).toHaveBeenCalled());
    const formData = actions.editOrderCommentAction.mock.calls[0]?.[1] as FormData;
    expect([formData.get("orderId"), formData.get("entryId"), formData.get("body")]).toEqual([
      "o-1",
      "e-1",
      "Called twice",
    ]);
    await waitFor(() => expect(screen.queryByLabelText("Comment")).toBeNull());
  });

  it("deletes only after the confirmation", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderItem(comment({ canEdit: false }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.deleteOrderCommentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteOrderCommentAction).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith("Delete this comment?");
  });
});
