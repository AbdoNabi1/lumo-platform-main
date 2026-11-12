import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  searchDraftProductsAction: vi.fn(),
  draftProductVariantsAction: vi.fn(),
}));
vi.mock("@/app/draft-orders/actions", () => actions);

const { DraftProductPicker } = await import("./draft-product-picker");
const { DraftProductsCard } = await import("./draft-products-card");

const { searchDraftProductsAction, draftProductVariantsAction } = actions;
const k = en.draftOrders.editor.picker;

const product = (id: string, title: string, variantCount = 1) => ({
  id,
  title,
  imageUrl: null,
  variantCount,
  priceMinor: 25000,
  currency: "EGP",
});
const variant = (id: string, variantTitle: string | null, priceMinor = 25000) => ({
  productId: "p-1",
  variantId: id,
  title: "Tee",
  variantTitle,
  sku: `TEE-${id}`,
  priceMinor,
  currency: "EGP",
  imageUrl: null,
});

function renderPicker(initialQuery = "") {
  const onAdd = vi.fn();
  render(
    <DraftProductPicker
      initialQuery={initialQuery}
      onAdd={onAdd}
      onClose={vi.fn()}
      t={en}
      locale="en"
    />,
  );
  return onAdd;
}

afterEach(() => {
  searchDraftProductsAction.mockReset();
  draftProductVariantsAction.mockReset();
});

describe("DraftProductPicker", () => {
  it("a search lists the matching products", async () => {
    searchDraftProductsAction.mockResolvedValue([]);
    renderPicker();
    searchDraftProductsAction.mockResolvedValue([product("p-1", "Tee"), product("p-2", "Cap")]);
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "te" } });
    expect(await screen.findByRole("button", { name: /Tee/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cap/ })).toBeInTheDocument();
    expect(searchDraftProductsAction).toHaveBeenLastCalledWith("te");
  });

  it("a single-variant product is added at once, quantity 1, with its display price", async () => {
    searchDraftProductsAction.mockResolvedValue([product("p-1", "Tee")]);
    draftProductVariantsAction.mockResolvedValue([variant("v-1", null)]);
    const onAdd = renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Tee/ }));
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        productId: "p-1",
        variantId: "v-1",
        quantity: 1,
        title: "Tee",
        variantTitle: null,
        sku: "TEE-v-1",
        imageUrl: null,
        unitPriceMinor: 25000,
      }),
    );
    expect(draftProductVariantsAction).toHaveBeenCalledWith("p-1");
  });

  it("a multi-variant product lists its variants, and an older search answering late is dropped", async () => {
    let answerOld: (value: unknown) => void = () => undefined;
    searchDraftProductsAction.mockResolvedValueOnce([]);
    renderPicker();
    await waitFor(() => expect(searchDraftProductsAction).toHaveBeenCalledTimes(1));
    searchDraftProductsAction.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)));
    searchDraftProductsAction.mockResolvedValueOnce([product("p-1", "Tee", 2)]);
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "ca" } });
    await waitFor(() => expect(searchDraftProductsAction).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText(k.search), { target: { value: "tee" } });
    await screen.findByRole("button", { name: /Tee/ });
    await act(async () => answerOld([product("p-9", "Cap")]));
    expect(screen.queryByRole("button", { name: /Cap/ })).toBeNull();

    draftProductVariantsAction.mockResolvedValue([variant("v-1", "M"), variant("v-2", "L", 27000)]);
    fireEvent.click(screen.getByRole("button", { name: /Tee/ }));
    expect(await screen.findByText(k.variants.replace("{title}", "Tee"))).toBeInTheDocument();
    const adds = screen.getAllByRole("button", { name: k.add });
    expect(adds).toHaveLength(2);
    expect(screen.getByText("L")).toBeInTheDocument();
  });
});

describe("DraftProductsCard", () => {
  it("typing in the card's search opens the picker with what was typed (spec §4.9)", async () => {
    searchDraftProductsAction.mockResolvedValue([product("p-1", "Tee")]);
    render(
      <DraftProductsCard
        lines={[]}
        onChange={vi.fn()}
        errors={{}}
        editable
        currency={null}
        t={en}
        locale="en"
      />,
    );
    fireEvent.change(screen.getByLabelText(en.draftOrders.editor.products.search), {
      target: { value: "t" },
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(k.search)).toHaveValue("t");
    await waitFor(() => expect(within(dialog).getByLabelText(k.search)).toHaveFocus());
    await waitFor(() => expect(searchDraftProductsAction).toHaveBeenCalledWith("t"));
  });

  it("adding a variant that is already a line raises its quantity (Ruling 20)", async () => {
    searchDraftProductsAction.mockResolvedValue([product("p-1", "Tee")]);
    draftProductVariantsAction.mockResolvedValue([variant("v-1", null)]);
    const onChange = vi.fn();
    render(
      <DraftProductsCard
        lines={[
          {
            productId: "p-1",
            variantId: "v-1",
            quantity: 2,
            title: "Tee",
            variantTitle: null,
            sku: "TEE",
            imageUrl: null,
            unitPriceMinor: 25000,
          },
        ]}
        onChange={onChange}
        errors={{ "lines.0": "this product can no longer be sold" }}
        editable
        currency="EGP"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("this product can no longer be sold");
    expect(screen.getByText("EGP 250.00 each")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.draftOrders.editor.products.browse }));
    fireEvent.click(await screen.findByRole("button", { name: /Tee/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ quantity: 3 })]),
    );
  });

  it("changes and removes a line's quantity", () => {
    const onChange = vi.fn();
    const line = {
      productId: "p-1",
      variantId: "v-1",
      quantity: 2,
      title: "Tee",
      variantTitle: null,
      sku: "TEE",
      imageUrl: null,
      unitPriceMinor: null,
    };
    render(
      <DraftProductsCard
        lines={[line]}
        onChange={onChange}
        errors={{}}
        editable
        currency="EGP"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.draftOrders.editor.products.pricedOnSave)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quantity of Tee"), { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...line, quantity: 5 }]);
    fireEvent.change(screen.getByLabelText("Quantity of Tee"), { target: { value: "١٢" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...line, quantity: 12 }]);
    fireEvent.change(screen.getByLabelText("Quantity of Tee"), { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...line, quantity: 12 }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Tee" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
