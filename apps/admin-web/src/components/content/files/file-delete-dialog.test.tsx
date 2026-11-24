import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { FileDeleteDialog } from "./file-delete-dialog";

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
});

/** The controlled dialog with real open state, so Escape / Cancel / the trigger behave for real. */
function Harness({
  t,
  pending = false,
  error = null,
  onConfirm = () => {},
  onOpenChange,
}: {
  readonly t: Dictionary;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm?: () => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <FileDeleteDialog
      name="Beach.png"
      t={t}
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        setOpen(next);
      }}
      pending={pending}
      error={error}
      onConfirm={onConfirm}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        trigger.current?.focus();
      }}
      triggerRef={trigger}
    />
  );
}

function open(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  render(<Harness t={en} {...props} />);
  const trigger = screen.getByRole("button", { name: (props.t ?? en).files.details.delete });
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
  });

  it("Cancel closes it, and focus returns to the trigger", async () => {
    const trigger = open();
    await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("confirming reports it once; it is the owner who closes the dialog", async () => {
    const onConfirm = vi.fn();
    open({ onConfirm });
    await body().findByRole("dialog", { name: "Delete file?" });

    fireEvent.click(body().getByRole("button", { name: "Delete file" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(body().getByRole("dialog", { name: "Delete file?" })).toBeInTheDocument();
  });

  it("while pending: the confirm button is busy and disabled, but Cancel and Escape still close", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const trigger = open({ pending: true, onConfirm, onOpenChange });
    const dialog = await body().findByRole("dialog", { name: "Delete file?" });

    const busy = within(dialog).getByRole("button", { name: "Deleting…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the refusal inside the open dialog", async () => {
    open({ error: en.files.delete.alreadyDeleted });
    const dialog = await body().findByRole("dialog", { name: "Delete file?" });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("This file was already deleted.");
  });

  it("renders in Arabic from ar.files.delete", async () => {
    open({ t: ar });

    const dialog = await body().findByRole("dialog", { name: ar.files.delete.title });
    expect(dialog).toHaveAccessibleDescription(ar.files.delete.body);
    expect(within(dialog).getByRole("button", { name: ar.files.delete.cancel })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: ar.files.delete.confirm })).toBeVisible();
    expect(within(dialog).queryByText(en.files.delete.title)).toBeNull();
  });
});
