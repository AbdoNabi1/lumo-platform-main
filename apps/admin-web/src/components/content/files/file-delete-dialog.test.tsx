import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({ archiveFileAction: vi.fn() }));
vi.mock("@/app/content/files/actions", () => actions);

const { FileDeleteDialog } = await import("./file-delete-dialog");

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  actions.archiveFileAction.mockReset();
});

function open(t: Dictionary = en, onDeleted?: () => void) {
  render(<FileDeleteDialog mediaAssetId="m-1" name="Beach.png" t={t} onDeleted={onDeleted} />);
  const trigger = screen.getByRole("button", { name: t.files.details.delete });
  fireEvent.click(trigger);
  return trigger;
}

describe("FileDeleteDialog", () => {
  it("opens a dialog titled 'Delete file?' described by the warning, with focus on Cancel", async () => {
    open();

    const dialog = await body().findByRole("dialog", { name: "Delete file?" });
    expect(dialog).toHaveAccessibleDescription(
      "Products and pages that use this file will stop showing it. This can't be undone.",
    );
    await waitFor(() => expect(body().getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(body().getByRole("button", { name: "Delete file" })).not.toHaveFocus();
    const name = within(dialog).getByText("Beach.png");
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
  });

  it("Escape closes it and focus returns to the trigger, which stayed mounted", async () => {
    const trigger = open();
    const dialog = await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.archiveFileAction).not.toHaveBeenCalled();
  });

  it("Cancel closes it without deleting, and focus returns to the trigger", async () => {
    const trigger = open();
    await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.archiveFileAction).not.toHaveBeenCalled();
  });

  it("confirming archives the file, closes the dialog and reports it deleted", async () => {
    actions.archiveFileAction.mockResolvedValue({ status: "success" });
    const onDeleted = vi.fn();
    open(en, onDeleted);
    await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Delete file" }));

    await waitFor(() => expect(actions.archiveFileAction).toHaveBeenCalledWith("m-1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
  });

  it("shows 'This file was already deleted.' inside the open dialog on the 409", async () => {
    actions.archiveFileAction.mockResolvedValue({
      status: "error",
      message: en.files.delete.alreadyDeleted,
      fieldErrors: {},
    });
    const onDeleted = vi.fn();
    open(en, onDeleted);
    const dialog = await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Delete file" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This file was already deleted.",
    );
    expect(body().getByRole("dialog", { name: "Delete file?" })).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("shows a generic message when the action throws", async () => {
    actions.archiveFileAction.mockRejectedValue(new Error("boom"));
    open();
    const dialog = await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Delete file" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(en.formErrors.unexpected);
  });

  it("renders in Arabic from ar.files.delete", async () => {
    open(ar);

    const dialog = await body().findByRole("dialog", { name: ar.files.delete.title });
    expect(dialog).toHaveAccessibleDescription(ar.files.delete.body);
    expect(within(dialog).getByRole("button", { name: ar.files.delete.cancel })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: ar.files.delete.confirm })).toBeVisible();
    expect(within(dialog).queryByText(en.files.delete.title)).toBeNull();
  });
});
