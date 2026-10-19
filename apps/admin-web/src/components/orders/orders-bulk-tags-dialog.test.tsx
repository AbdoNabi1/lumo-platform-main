import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { OrdersBulkTagsDialog } from "./orders-bulk-tags-dialog";

vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));

describe("OrdersBulkTagsDialog", () => {
  it("collects up to 20 tags and submits them", () => {
    const onSubmit = vi.fn();
    render(
      <OrdersBulkTagsDialog
        open
        title="Add tags to 2 orders"
        submitLabel="Add"
        pending={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        t={en}
      />,
    );
    const submit = screen.getByRole("button", { name: "Add" });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, {
      target: { value: Array.from({ length: 25 }, (_, i) => `t${i}`).join(",") + "," },
    });
    expect(screen.getAllByRole("button", { name: /^Remove t/ })).toHaveLength(20);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(Array.from({ length: 20 }, (_, i) => `t${i}`));
  });
});
