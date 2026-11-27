import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({ deleteCollectionAction: vi.fn() }));
vi.mock("@/app/collections/actions", () => actions);

const { CollectionDeleteDialog } = await import("./collection-delete-dialog");

const body = () => within(document.body);

beforeEach(() => {
  expect.hasAssertions();
  actions.deleteCollectionAction.mockReset();
});

function open(t: Dictionary = en) {
  render(<CollectionDeleteDialog collectionId="c-1" name="Summer" t={t} />);
  const trigger = screen.getByRole("button", { name: t.collections.delete.trigger });
  fireEvent.click(trigger);
  return trigger;
}

describe("CollectionDeleteDialog", () => {
  it("opens a dialog named by its title, with the warning as its description and focus on Cancel", async () => {
    open();

    const dialog = await body().findByRole("dialog", { name: en.collections.delete.title });
    expect(dialog).toHaveAccessibleDescription(
      en.collections.delete.body.replace("{name}", "Summer"),
    );
    await waitFor(() =>
      expect(body().getByRole("button", { name: en.collections.delete.cancel })).toHaveFocus(),
    );
    expect(body().getByRole("button", { name: en.collections.delete.confirm })).not.toHaveFocus();
    expect(dialog.querySelector("bdi")).toHaveTextContent("Summer");
    expect(dialog.querySelector("bdi")).toHaveAttribute("dir", "auto");
  });

  it("Escape closes it and focus returns to the trigger, which stayed mounted", async () => {
    const trigger = open();
    const dialog = await body().findByRole("dialog", { name: en.collections.delete.title });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.deleteCollectionAction).not.toHaveBeenCalled();
  });

  it("Cancel closes it without deleting and focus returns to the trigger", async () => {
    const trigger = open();
    await body().findByRole("dialog", { name: en.collections.delete.title });

    fireEvent.click(body().getByRole("button", { name: en.collections.delete.cancel }));

    await waitFor(() => expect(body().queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(actions.deleteCollectionAction).not.toHaveBeenCalled();
  });

  it("confirming submits the collection id to the delete action", async () => {
    actions.deleteCollectionAction.mockResolvedValue({ status: "success" });
    open();
    await body().findByRole("dialog", { name: en.collections.delete.title });

    fireEvent.click(body().getByRole("button", { name: en.collections.delete.confirm }));

    await waitFor(() => expect(actions.deleteCollectionAction).toHaveBeenCalledTimes(1));
    const data = actions.deleteCollectionAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("collectionId")).toBe("c-1");
  });

  it("shows a refusal inside the open dialog, never closing it", async () => {
    actions.deleteCollectionAction.mockResolvedValue({
      status: "error",
      message: "Cannot delete",
      fieldErrors: {},
    });
    open();
    const dialog = await body().findByRole("dialog", { name: en.collections.delete.title });

    fireEvent.click(body().getByRole("button", { name: en.collections.delete.confirm }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Cannot delete");
    expect(body().getByRole("dialog", { name: en.collections.delete.title })).toBeInTheDocument();
  });

  it("renders in Arabic from ar.collections.delete", async () => {
    open(ar);

    const dialog = await body().findByRole("dialog", { name: ar.collections.delete.title });
    expect(
      within(dialog).getByRole("button", { name: ar.collections.delete.cancel }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: ar.collections.delete.confirm }),
    ).toBeVisible();
    expect(within(dialog).queryByText(en.collections.delete.title)).toBeNull();
  });
});
