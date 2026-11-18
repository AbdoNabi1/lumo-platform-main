import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrdersBulkTagsDialog } from "./orders-bulk-tags-dialog";

vi.mock("@/app/orders/annotation-actions", () => ({
  suggestOrderTagsAction: vi.fn().mockResolvedValue([]),
}));

function renderDialog(onSubmit = vi.fn(), t: typeof en | typeof ar = en) {
  render(
    <OrdersBulkTagsDialog
      open
      title="Add tags to 2 orders"
      submitLabel="Add"
      pending={false}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      t={t}
    />,
  );
  return onSubmit;
}

describe("OrdersBulkTagsDialog", () => {
  it("collects up to 20 tags and submits them", () => {
    const onSubmit = renderDialog();
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

  it("at 20 tags the input is read-only and says so", () => {
    renderDialog();
    expect(screen.queryByText("Up to 20 tags")).toBeNull();
    const input = screen.getByLabelText("Tags");
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, {
      target: { value: Array.from({ length: 20 }, (_, i) => `t${i}`).join(",") + "," },
    });
    expect(screen.getByLabelText("Tags")).toHaveAttribute("readonly");
    expect(screen.getByText("Up to 20 tags")).toBeInTheDocument();
  });

  it("says the cap in Arabic", () => {
    renderDialog(vi.fn(), ar);
    fireEvent.change(screen.getByLabelText("العلامات"), {
      target: { value: Array.from({ length: 20 }, (_, i) => `t${i}`).join(",") + "," },
    });
    expect(screen.getByText("حتى ٢٠ علامة")).toBeInTheDocument();
  });

  it("Add sends the chips AND the text typed but not yet committed", () => {
    const onSubmit = renderDialog();
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, { target: { value: "vip," } });
    fireEvent.change(input, { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenCalledWith(["vip", "urgent"]);
  });

  it("Add is enabled and sends the text when nothing was committed", () => {
    const onSubmit = renderDialog();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "vip، urgent" } });
    const submit = screen.getByRole("button", { name: "Add" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(["vip", "urgent"]);
  });

  it("keeps typed text beyond the 20-tag cap out of the request", () => {
    const onSubmit = renderDialog();
    const input = screen.getByLabelText("Tags");
    fireEvent.change(input, {
      target: { value: Array.from({ length: 19 }, (_, i) => `t${i}`).join(",") + "," },
    });
    fireEvent.change(input, { target: { value: "x,y,z" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).toHaveBeenCalledWith([...Array.from({ length: 19 }, (_, i) => `t${i}`), "x"]);
  });

  it("blocks Add while the typed text holds a tag over 40 characters, with the message", () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "ok,".concat("x".repeat(41)) },
    });
    // "ok," committed "ok" as a chip; the long piece stays pending.
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("A tag can have at most 40 characters.");
  });

  it("blocks Add when only a too-long tag was typed", () => {
    const onSubmit = renderDialog();
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "y".repeat(41) } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("A tag can have at most 40 characters.");
  });
});
