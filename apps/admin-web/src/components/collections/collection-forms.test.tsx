import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  createCollectionAction: vi.fn(),
  renameCollectionAction: vi.fn(),
  setCollectionStatusAction: vi.fn(),
}));
vi.mock("@/app/collections/actions", () => actions);

const { CollectionCreateForm } = await import("./collection-create-form");
const { CollectionTitleCard, CollectionStatusCard } = await import("./collection-settings-cards");

const k = en.collections;

beforeEach(() => {
  expect.hasAssertions();
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("CollectionCreateForm", () => {
  it("pre-fills the handle from the title, lowercased with dashes", () => {
    render(<CollectionCreateForm t={en} />);

    fireEvent.change(screen.getByLabelText(k.form.title), {
      target: { value: "Summer Sale 2026!" },
    });

    expect(screen.getByLabelText(k.form.handle)).toHaveValue("summer-sale-2026");
  });

  it("leaves the handle empty for an Arabic title, for the merchant to type", () => {
    render(<CollectionCreateForm t={en} />);

    fireEvent.change(screen.getByLabelText(k.form.title), { target: { value: "مجموعة الصيف" } });

    expect(screen.getByLabelText(k.form.handle)).toHaveValue("");
  });

  it("stops following the title once the handle was edited by hand", () => {
    render(<CollectionCreateForm t={en} />);
    const title = screen.getByLabelText(k.form.title);
    const handle = screen.getByLabelText(k.form.handle);

    fireEvent.change(title, { target: { value: "Summer" } });
    fireEvent.change(handle, { target: { value: "sun" } });
    fireEvent.change(title, { target: { value: "Summer Sale" } });

    expect(handle).toHaveValue("sun");
  });

  it("submits title and handle to the create action", async () => {
    actions.createCollectionAction.mockResolvedValue({ status: "idle" });
    render(<CollectionCreateForm t={en} />);

    fireEvent.change(screen.getByLabelText(k.form.title), { target: { value: "Summer" } });
    fireEvent.click(screen.getByRole("button", { name: k.form.save }));

    await waitFor(() => expect(actions.createCollectionAction).toHaveBeenCalledTimes(1));
    const data = actions.createCollectionAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("name")).toBe("Summer");
    expect(data.get("slug")).toBe("summer");
  });

  it("shows field errors next to their inputs and keeps what was typed", async () => {
    actions.createCollectionAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { slug: "Handle already in use" },
    });
    render(<CollectionCreateForm t={en} />);
    fireEvent.change(screen.getByLabelText(k.form.title), { target: { value: "Summer" } });

    fireEvent.click(screen.getByRole("button", { name: k.form.save }));

    expect(await screen.findByText("Handle already in use")).toBeVisible();
    expect(screen.getByLabelText(k.form.handle)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(k.form.handle)).toHaveValue("summer");
    expect(screen.getByLabelText(k.form.title)).toHaveValue("Summer");
  });

  it("renders in Arabic from ar.collections.form, the handle left-to-right and start-aligned", () => {
    render(<CollectionCreateForm t={ar} />);

    expect(screen.getByLabelText(ar.collections.form.title)).toHaveAttribute("dir", "auto");
    const handle = screen.getByLabelText(ar.collections.form.handle);
    expect(handle).toHaveAttribute("dir", "ltr");
    expect(handle).toHaveClass("text-start");
    expect(screen.getByRole("button", { name: ar.collections.form.save })).toBeVisible();
    expect(screen.queryByText(en.collections.form.title)).toBeNull();
  });
});

describe("CollectionTitleCard", () => {
  it("renames: Save is off until the title changes, then submits id and name", async () => {
    actions.renameCollectionAction.mockResolvedValue({ status: "success" });
    render(<CollectionTitleCard collectionId="c-1" name="Summer" slug="summer" t={en} />);
    const save = screen.getByRole("button", { name: k.form.save });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(k.form.title), { target: { value: "Winter" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(actions.renameCollectionAction).toHaveBeenCalledTimes(1));
    const data = actions.renameCollectionAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("collectionId")).toBe("c-1");
    expect(data.get("name")).toBe("Winter");
    expect(await screen.findByRole("status")).toHaveTextContent(k.form.saved);
  });

  it("shows the handle read-only, isolated left-to-right", () => {
    render(<CollectionTitleCard collectionId="c-1" name="Summer" slug="summer" t={en} />);

    expect(screen.getByText("summer").tagName).toBe("BDI");
    expect(screen.getByText("summer")).toHaveAttribute("dir", "ltr");
  });

  it("shows an API refusal in an alert", async () => {
    actions.renameCollectionAction.mockResolvedValue({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    render(<CollectionTitleCard collectionId="c-1" name="Summer" slug="summer" t={en} />);
    fireEvent.change(screen.getByLabelText(k.form.title), { target: { value: "Winter" } });

    fireEvent.click(screen.getByRole("button", { name: k.form.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.formErrors.forbidden);
  });
});

describe("CollectionStatusCard", () => {
  it("offers Active and Draft and submits the chosen status", async () => {
    actions.setCollectionStatusAction.mockResolvedValue({ status: "success" });
    render(<CollectionStatusCard collectionId="c-1" status="draft" t={en} />);
    const select = screen.getByLabelText(k.statusCard.label);
    expect(select).toHaveValue("draft");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      k.statusPublished,
      k.statusDraft,
    ]);
    const save = screen.getByRole("button", { name: k.form.save });
    expect(save).toBeDisabled();

    fireEvent.change(select, { target: { value: "published" } });
    fireEvent.click(save);

    await waitFor(() => expect(actions.setCollectionStatusAction).toHaveBeenCalledTimes(1));
    const data = actions.setCollectionStatusAction.mock.calls[0]?.[1] as FormData;
    expect(data.get("collectionId")).toBe("c-1");
    expect(data.get("value")).toBe("published");
  });

  it("renders in Arabic", () => {
    render(<CollectionStatusCard collectionId="c-1" status="published" t={ar} />);

    expect(screen.getByText(ar.collections.statusCard.title)).toBeVisible();
    expect(screen.getByLabelText(ar.collections.statusCard.label)).toHaveValue("published");
    expect(screen.getByRole("option", { name: ar.collections.statusDraft })).toBeInTheDocument();
  });
});
