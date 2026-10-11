import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProductImageDto } from "@/lib/api/products";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  uploadProductImageAction: vi.fn(),
  attachProductMediaAction: vi.fn(),
  detachProductMediaAction: vi.fn(),
  reorderProductMediaAction: vi.fn(),
  updateMediaAltAction: vi.fn(),
}));
const prepare = vi.hoisted(() => ({ prepareImage: vi.fn() }));
vi.mock("@/app/products/actions", () => actions);
vi.mock("@/lib/media/prepare-image", () => prepare);

const { ProductMediaCard } = await import("./media-card");

const t = en.productMedia;
const SUCCESS = { status: "success" } as const;

const image = (id: string, alt: string | null = null): ProductImageDto => ({
  id,
  url: `https://cdn.example.test/${id}.webp`,
  alt,
  width: 800,
  height: 600,
});
const png = (name: string) => new File(["x"], name, { type: "image/png" });

function renderCard(props: Partial<React.ComponentProps<typeof ProductMediaCard>> = {}) {
  return render(
    <ProductMediaCard productId="p1" productName="Plush Bear" media={[]} t={en} {...props} />,
  );
}

const dropzone = () => screen.getByTestId("media-dropzone");
const drop = (files: File[]) =>
  fireEvent.drop(dropzone(), { dataTransfer: { files, types: ["Files"] } });
const tile = (id: string) => screen.getByTestId(`media-tile-${id}`);
const ids = () =>
  screen.queryAllByTestId(/^media-tile-/).map((el) => el.getAttribute("data-testid")!.slice(11));
const formOf = (mock: ReturnType<typeof vi.fn>, call = 0) => mock.mock.calls[call]![1] as FormData;

async function openMenu(id: string, item: string) {
  const trigger = within(tile(id)).getByRole("button", { name: /actions/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

beforeEach(() => {
  vi.resetAllMocks();
  prepare.prepareImage.mockImplementation(async (file: File) => ({ ok: true, file }));
  actions.attachProductMediaAction.mockResolvedValue(SUCCESS);
  actions.detachProductMediaAction.mockResolvedValue(SUCCESS);
  actions.reorderProductMediaAction.mockResolvedValue(SUCCESS);
  actions.updateMediaAltAction.mockResolvedValue(SUCCESS);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductMediaCard — empty state", () => {
  it("shows a dashed drop zone with Upload new and the accepted types and size", () => {
    renderCard();
    expect(dropzone().className).toContain("border-dashed");
    expect(screen.getByRole("button", { name: t.uploadNew })).toBeInTheDocument();
    expect(screen.getByText(t.accepts)).toBeInTheDocument();
    expect(ids()).toEqual([]);
  });

  it("offers a multiple-file input limited to the four image types", () => {
    const { container } = renderCard();
    const input = container.querySelector('input[type="file"]')!;
    expect(input).toHaveAttribute("multiple");
    expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp,image/gif");
  });
});

describe("ProductMediaCard — uploading", () => {
  it("makes a tile per dropped file, uploads two at a time, and attaches the batch once, in file order", async () => {
    let inFlight = 0;
    let peak = 0;
    const resolvers: Record<string, () => void> = {};
    actions.uploadProductImageAction.mockImplementation(async (form: FormData) => {
      const name = (form.get("file") as File).name;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => {
        resolvers[name] = resolve;
      });
      inFlight -= 1;
      return { status: "ok", image: image(`img-${name}`) };
    });
    renderCard();

    drop([png("a.png"), png("b.png"), png("c.png")]);

    expect(await screen.findAllByText(t.uploading)).toHaveLength(3);
    await waitFor(() => expect(actions.uploadProductImageAction).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);

    // finish b first, then a: the third starts as soon as a slot frees up
    await act(async () => resolvers["b.png"]!());
    await waitFor(() => expect(actions.uploadProductImageAction).toHaveBeenCalledTimes(3));
    await act(async () => resolvers["a.png"]!());
    await act(async () => resolvers["c.png"]!());

    await waitFor(() => expect(actions.attachProductMediaAction).toHaveBeenCalledTimes(1));
    expect(peak).toBe(2);
    const form = formOf(actions.attachProductMediaAction);
    expect(form.get("productId")).toBe("p1");
    expect(form.getAll("assetId")).toEqual(["img-a.png", "img-b.png", "img-c.png"]);
    expect(ids()).toEqual(["img-a.png", "img-b.png", "img-c.png"]);
  });

  it("shows a per-file error for a file that is too large, unsupported, or fails, each with a retry", async () => {
    prepare.prepareImage
      .mockResolvedValueOnce({ ok: false, reason: "too_large" })
      .mockResolvedValueOnce({ ok: false, reason: "unsupported" })
      .mockImplementationOnce(async (file: File) => ({ ok: true, file }));
    actions.uploadProductImageAction.mockResolvedValueOnce({ status: "error", reason: "failed" });
    renderCard();

    drop([png("big.png"), png("logo.svg"), png("flaky.png")]);

    expect(await screen.findByText(t.errorTooLarge)).toBeInTheDocument();
    expect(await screen.findByText(t.errorUnsupported)).toBeInTheDocument();
    expect(await screen.findByText(t.errorFailed)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: t.retry })).toHaveLength(3);
    expect(actions.attachProductMediaAction).not.toHaveBeenCalled();
  });

  it("retrying a failed upload uploads that file again and attaches it", async () => {
    actions.uploadProductImageAction
      .mockResolvedValueOnce({ status: "error", reason: "failed" })
      .mockResolvedValueOnce({ status: "ok", image: image("img-1") });
    renderCard();
    drop([png("a.png")]);

    fireEvent.click(await screen.findByRole("button", { name: t.retry }));

    await waitFor(() => expect(ids()).toEqual(["img-1"]));
    expect(formOf(actions.attachProductMediaAction).getAll("assetId")).toEqual(["img-1"]);
  });

  it("says once, in the card, that image storage is not set up — and leaves no error tiles", async () => {
    actions.uploadProductImageAction.mockResolvedValue({
      status: "error",
      reason: "unavailable",
    });
    renderCard();

    drop([png("a.png"), png("b.png"), png("c.png")]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t.storageNotSetUp);
    await waitFor(() => expect(screen.queryAllByText(t.uploading)).toHaveLength(0));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(t.errorFailed)).not.toBeInTheDocument();
    expect(ids()).toEqual([]);
  });
});

describe("ProductMediaCard — the grid", () => {
  const three = [image("a", "Front"), image("b"), image("c", "Back")];

  it("makes the first image large and the rest square tiles, with a final add tile", () => {
    renderCard({ media: three });
    expect(tile("a").className).toContain("sm:col-span-2");
    expect(tile("a").className).toContain("sm:row-span-2");
    expect(tile("b").className).not.toContain("sm:col-span-2");
    expect(screen.getByRole("button", { name: t.addMore })).toBeInTheDocument();
    expect(within(tile("a")).getByText(t.featured)).toBeInTheDocument();
  });

  it("describes each image with its alt text, else the product title", () => {
    renderCard({ media: three });
    expect(within(tile("a")).getByRole("img")).toHaveAttribute("alt", "Front");
    expect(within(tile("b")).getByRole("img")).toHaveAttribute("alt", "Plush Bear");
  });

  it("moves an image later from its menu, saving the new order at once", async () => {
    renderCard({ media: three });
    await openMenu("a", t.moveLater);
    await waitFor(() => expect(actions.reorderProductMediaAction).toHaveBeenCalledTimes(1));
    expect(formOf(actions.reorderProductMediaAction).getAll("assetIds")).toEqual(["b", "a", "c"]);
    expect(formOf(actions.reorderProductMediaAction).get("productId")).toBe("p1");
    expect(ids()).toEqual(["b", "a", "c"]);
  });

  it("moves an image earlier, and makes one featured (to the front)", async () => {
    renderCard({ media: three });
    await openMenu("c", t.moveEarlier);
    await waitFor(() => expect(ids()).toEqual(["a", "c", "b"]));

    await openMenu("b", t.makeFeatured);
    await waitFor(() => expect(ids()).toEqual(["b", "a", "c"]));
    expect(formOf(actions.reorderProductMediaAction, 1).getAll("assetIds")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("offers no impossible moves: the first cannot move earlier or be made featured, the last cannot move later", async () => {
    renderCard({ media: three });
    fireEvent.keyDown(within(tile("a")).getByRole("button", { name: /actions/ }), {
      key: "Enter",
    });
    expect(await screen.findByRole("menuitem", { name: t.moveLater })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t.moveEarlier })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t.makeFeatured })).not.toBeInTheDocument();
  });

  it("puts the order back and says so when saving it fails", async () => {
    actions.reorderProductMediaAction.mockResolvedValue({
      status: "error",
      message: "x",
      fieldErrors: {},
    });
    renderCard({ media: three });
    await openMenu("a", t.moveLater);
    expect(await screen.findByRole("alert")).toHaveTextContent(t.reorderFailed);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("reorders by dragging one tile onto another", async () => {
    renderCard({ media: three });
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), types: [], files: [] };
    fireEvent.dragStart(tile("c"), { dataTransfer });
    fireEvent.dragOver(tile("a"), { dataTransfer });
    fireEvent.drop(tile("a"), { dataTransfer });
    await waitFor(() => expect(ids()).toEqual(["c", "a", "b"]));
    expect(formOf(actions.reorderProductMediaAction).getAll("assetIds")).toEqual(["c", "a", "b"]);
  });
});

describe("ProductMediaCard — the image dialog", () => {
  const open = (id: string) => fireEvent.click(screen.getByTestId(`media-open-${id}`));

  it("shows the image large with its alt text and the hint, and Save only once the text changed", async () => {
    renderCard({ media: [image("a", "Front")] });
    open("a");

    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(t.altLabel);
    expect(field).toHaveValue("Front");
    expect(within(dialog).getByText(t.altHint)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: t.save })).toBeDisabled();

    fireEvent.change(field, { target: { value: "Front view" } });
    expect(within(dialog).getByRole("button", { name: t.save })).toBeEnabled();

    fireEvent.change(field, { target: { value: "Front" } });
    expect(within(dialog).getByRole("button", { name: t.save })).toBeDisabled();
  });

  it("saves the alt text of that image", async () => {
    renderCard({ media: [image("a", "Front")] });
    open("a");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(t.altLabel), {
      target: { value: "Front view" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));

    await waitFor(() => expect(actions.updateMediaAltAction).toHaveBeenCalledTimes(1));
    const form = formOf(actions.updateMediaAltAction);
    expect(form.get("mediaId")).toBe("a");
    expect(form.get("alt")).toBe("Front view");
    expect(form.get("productId")).toBe("p1");
  });

  it("deletes the image after confirming, and not when the confirmation is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard({ media: [image("a"), image("b")] });
    open("a");
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t.delete }));
    expect(confirm).toHaveBeenCalledWith(t.confirmDelete);
    expect(actions.detachProductMediaAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole("button", { name: t.delete }));
    await waitFor(() => expect(actions.detachProductMediaAction).toHaveBeenCalledTimes(1));
    expect(formOf(actions.detachProductMediaAction).getAll("assetId")).toEqual(["a"]);
    await waitFor(() => expect(ids()).toEqual(["b"]));
    dialog = undefined as never;
  });
});

describe("ProductMediaCard — selecting several", () => {
  it("shows how many are selected and deletes them together after confirming", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ media: [image("a"), image("b"), image("c")] });

    fireEvent.click(within(tile("a")).getByRole("checkbox"));
    fireEvent.click(within(tile("c")).getByRole("checkbox"));

    expect(screen.getByText(t.selectedCount.replace("{count}", "2"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.deleteSelected }));

    expect(confirm).toHaveBeenCalledWith(t.confirmDeleteMany.replace("{count}", "2"));
    await waitFor(() => expect(actions.detachProductMediaAction).toHaveBeenCalledTimes(1));
    expect(formOf(actions.detachProductMediaAction).getAll("assetId").sort()).toEqual(["a", "c"]);
    await waitFor(() => expect(ids()).toEqual(["b"]));
  });

  it("clears the selection without deleting", () => {
    renderCard({ media: [image("a"), image("b")] });
    fireEvent.click(within(tile("a")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t.clearSelection }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(actions.detachProductMediaAction).not.toHaveBeenCalled();
  });
});

describe("ProductMediaCard — create mode (no product yet)", () => {
  function renderInForm() {
    return render(
      <>
        <form id="product-editor" data-testid="editor" />
        <ProductMediaCard
          productId={null}
          productName=""
          media={[]}
          t={en}
          formId="product-editor"
        />
      </>,
    );
  }
  const posted = () =>
    new FormData(screen.getByTestId("editor") as HTMLFormElement).getAll("mediaAssetId");

  it("uploads, keeps the ids in hidden inputs joined to the product form, and attaches nothing yet", async () => {
    actions.uploadProductImageAction
      .mockResolvedValueOnce({ status: "ok", image: image("m1") })
      .mockResolvedValueOnce({ status: "ok", image: image("m2") });
    renderInForm();

    drop([png("a.png"), png("b.png")]);

    await waitFor(() => expect(posted()).toEqual(["m1", "m2"]));
    expect(actions.attachProductMediaAction).not.toHaveBeenCalled();
  });

  it("reorders and deletes locally, and the hidden inputs follow", async () => {
    actions.uploadProductImageAction
      .mockResolvedValueOnce({ status: "ok", image: image("m1") })
      .mockResolvedValueOnce({ status: "ok", image: image("m2") })
      .mockResolvedValueOnce({ status: "ok", image: image("m3") });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderInForm();
    drop([png("a.png"), png("b.png"), png("c.png")]);
    await waitFor(() => expect(posted()).toEqual(["m1", "m2", "m3"]));

    await openMenu("m3", t.makeFeatured);
    await waitFor(() => expect(posted()).toEqual(["m3", "m1", "m2"]));

    fireEvent.click(within(tile("m1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t.deleteSelected }));
    await waitFor(() => expect(posted()).toEqual(["m3", "m2"]));

    expect(actions.reorderProductMediaAction).not.toHaveBeenCalled();
    expect(actions.detachProductMediaAction).not.toHaveBeenCalled();
  });

  it("falls back to a numbered description when the product has no title yet", async () => {
    actions.uploadProductImageAction.mockResolvedValueOnce({ status: "ok", image: image("m1") });
    renderInForm();
    drop([png("a.png")]);
    await waitFor(() => expect(posted()).toEqual(["m1"]));
    expect(within(tile("m1")).getByRole("img")).toHaveAttribute(
      "alt",
      t.imageFallbackAlt.replace("{n}", "1"),
    );
  });
});
