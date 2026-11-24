import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";

const actions = vi.hoisted(() => ({
  searchCollectionProductsAction: vi.fn(),
  // Anything else the module exports must NOT be reached by the picker.
  addCollectionProductAction: vi.fn(),
  draftProductVariantsAction: vi.fn(),
}));
vi.mock("@/app/collections/actions", () => actions);

const { CollectionProductPicker } = await import("./collection-product-picker");

const { searchCollectionProductsAction: search } = actions;
const k = en.collections.picker;
const body = () => within(document.body);

const draftTee = { id: "p-1", name: "Draft tee", status: "draft" };
const liveCap = { id: "p-2", name: "Live cap", status: "published" };

function renderPicker(options: { excludeIds?: readonly string[]; t?: Dictionary } = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <CollectionProductPicker
      onPick={onPick}
      onClose={onClose}
      t={options.t ?? en}
      {...(options.excludeIds === undefined ? {} : { excludeIds: options.excludeIds })}
    />,
  );
  return { onPick, onClose };
}

/** Runs the debounce timer and lets the action's promise settle. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe("CollectionProductPicker", () => {
  it("opens a real dialog with the search field focused", async () => {
    search.mockResolvedValue([]);
    renderPicker();

    const dialog = body().getByRole("dialog", { name: k.title });
    expect(dialog).toHaveAccessibleDescription(k.description);
    await elapse(0);
    expect(within(dialog).getByLabelText(k.search)).toHaveFocus();
  });

  it("makes no search call before 300 ms of quiet, then exactly one", async () => {
    search.mockResolvedValue([]);
    renderPicker();

    await elapse(299);
    expect(search).not.toHaveBeenCalled();

    await elapse(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenLastCalledWith("");
  });

  it("restarts the debounce on every keystroke and searches only the final text", async () => {
    search.mockResolvedValue([]);
    renderPicker();
    await elapse(300);
    search.mockClear();

    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "t" } });
    await elapse(200);
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "te" } });
    await elapse(200);
    expect(search).not.toHaveBeenCalled();
    await elapse(100);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("te");
  });

  it("lists a draft and a published product, both pickable, each name in <bdi dir=auto>", async () => {
    search.mockResolvedValue([draftTee, liveCap]);
    renderPicker();
    await elapse(300);

    const dialog = body().getByRole("dialog", { name: k.title });
    const draft = within(dialog).getByRole("button", { name: new RegExp(draftTee.name) });
    const live = within(dialog).getByRole("button", { name: new RegExp(liveCap.name) });
    expect(draft).toBeEnabled();
    expect(live).toBeEnabled();
    expect(draft).toHaveTextContent(en.productStatus.draft);
    expect(live).toHaveTextContent(en.productStatus.published);
    for (const [button, name] of [
      [draft, draftTee.name],
      [live, liveCap.name],
    ] as const) {
      const bdi = button.querySelector("bdi");
      expect(bdi).toHaveTextContent(name);
      expect(bdi).toHaveAttribute("dir", "auto");
    }
  });

  it("picking returns the product id — and calls nothing but the search action", async () => {
    search.mockResolvedValue([draftTee, liveCap]);
    const { onPick, onClose } = renderPicker();
    await elapse(300);

    fireEvent.click(body().getByRole("button", { name: new RegExp(draftTee.name) }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("p-1");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(actions.draftProductVariantsAction).not.toHaveBeenCalled();
    expect(actions.addCollectionProductAction).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("an older, slower answer arriving after a newer one does not replace the list", async () => {
    let answerOld: (value: unknown) => void = () => undefined;
    search.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)));
    renderPicker();
    await elapse(300);
    expect(search).toHaveBeenCalledTimes(1);

    search.mockResolvedValueOnce([liveCap]);
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "cap" } });
    await elapse(300);
    expect(body().getByRole("button", { name: new RegExp(liveCap.name) })).toBeVisible();

    await act(async () => answerOld([draftTee]));

    expect(body().queryByRole("button", { name: new RegExp(draftTee.name) })).toBeNull();
    expect(body().getByRole("button", { name: new RegExp(liveCap.name) })).toBeVisible();
  });

  it("shows no results, and treats a failed search as no results", async () => {
    search.mockResolvedValueOnce([]);
    renderPicker();
    expect(body().getByText(k.loading)).toBeVisible();
    await elapse(300);
    expect(body().getByText(k.noResults)).toBeVisible();

    search.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "x" } });
    await elapse(300);
    expect(body().getByText(k.noResults)).toBeVisible();
  });

  it("lists products already in the collection but does not let them be picked twice", async () => {
    search.mockResolvedValue([draftTee, liveCap]);
    const { onPick } = renderPicker({ excludeIds: ["p-1"] });
    await elapse(300);

    const added = body().getByRole("button", { name: new RegExp(draftTee.name) });
    expect(added).toBeDisabled();
    expect(added).toHaveTextContent(k.alreadyAdded);
    fireEvent.click(added);
    expect(onPick).not.toHaveBeenCalled();
    expect(body().getByRole("button", { name: new RegExp(liveCap.name) })).toBeEnabled();
  });

  it("Escape closes it", async () => {
    search.mockResolvedValue([]);
    const { onClose } = renderPicker();
    await elapse(300);

    fireEvent.keyDown(body().getByRole("dialog", { name: k.title }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders in Arabic from ar.collections.picker", async () => {
    search.mockResolvedValue([draftTee]);
    renderPicker({ t: ar });
    await elapse(300);

    const dialog = body().getByRole("dialog", { name: ar.collections.picker.title });
    expect(within(dialog).getByLabelText(ar.collections.picker.search)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /Draft tee/ })).toHaveTextContent(
      ar.productStatus.draft,
    );
  });
});
