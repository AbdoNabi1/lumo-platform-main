import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({ deleteSegmentAction: vi.fn() }));
vi.mock("@/app/customers/segments/actions", () => actions);

const { SegmentDeleteDialog } = await import("./segment-delete-dialog");

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  actions.deleteSegmentAction.mockReset();
  actions.deleteSegmentAction.mockResolvedValue({ status: "success" });
});

function open(t: Dictionary = en, name = "Loyal customers") {
  render(<SegmentDeleteDialog segmentId="s-1" version={4} name={name} t={t} />);
  const trigger = screen.getByRole("button", { name: t.segments.delete.trigger });
  fireEvent.click(trigger);
  return trigger;
}

describe("SegmentDeleteDialog", () => {
  it("opens a titled dialog described by what is (not) lost, naming the segment in a bdi, with focus on Cancel", async () => {
    open();

    const dialog = await body().findByRole("dialog", { name: "Delete this segment?" });
    expect(dialog).toHaveAccessibleDescription(
      "Loyal customers will be deleted. The customers in it aren't affected. This can't be undone.",
    );
    const name = within(dialog).getByText("Loyal customers");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    await waitFor(() => expect(body().getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(body().getByRole("button", { name: "Delete segment", hidden: false })).not.toHaveFocus();
  });

  it("Escape closes it and focus returns to the trigger, which stayed mounted", async () => {
    const trigger = open();
    const dialog = await body().findByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.deleteSegmentAction).not.toHaveBeenCalled();
  });

  it("Cancel closes it, focus returns to the trigger, and nothing is deleted", async () => {
    const trigger = open();
    await body().findByRole("dialog");

    fireEvent.click(body().getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.deleteSegmentAction).not.toHaveBeenCalled();
  });

  it("confirming deletes with the loaded version", async () => {
    open();
    const dialog = await body().findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete segment" }));

    await waitFor(() => expect(actions.deleteSegmentAction).toHaveBeenCalledWith("s-1", 4));
    expect(actions.deleteSegmentAction).toHaveBeenCalledTimes(1);
  });

  it("while the delete is in flight the confirm button is busy and disabled", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.deleteSegmentAction.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    open();
    const dialog = await body().findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete segment" }));

    const busy = await within(dialog).findByRole("button", { name: "Deleting…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(actions.deleteSegmentAction).toHaveBeenCalledTimes(1);
    finish({ status: "success" });
  });

  it("shows a refusal inside the open dialog, and reopening starts clean", async () => {
    actions.deleteSegmentAction.mockResolvedValue({
      status: "error",
      message: en.segments.errors.stale,
      fieldErrors: {},
    });
    const trigger = open();
    const dialog = await body().findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete segment" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.segments.errors.stale);
    expect(body().getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(body().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    fireEvent.click(trigger);

    const again = await body().findByRole("dialog");
    expect(within(again).queryByRole("alert")).toBeNull();
  });

  it("renders in Arabic from ar.segments.delete", async () => {
    open(ar, "العملاء الأوفياء");

    const dialog = await body().findByRole("dialog", { name: ar.segments.delete.title });
    // The name sits in an inline <bdi>, which the accessible-description algorithm separates by a space.
    expect(dialog).toHaveAccessibleDescription(
      /^سيتم حذف\s+العملاء الأوفياء\s*\. لا يتأثر العملاء الموجودون فيها\. لا يمكن التراجع عن ذلك\.$/,
    );
    expect(within(dialog).getByRole("button", { name: ar.segments.delete.cancel })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: ar.segments.delete.confirm })).toBeVisible();
    expect(within(dialog).queryByText(en.segments.delete.title)).toBeNull();
  });
});
