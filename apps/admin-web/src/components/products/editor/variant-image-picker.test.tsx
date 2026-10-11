import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProductImageDto } from "@/lib/api/products";
import { en } from "@/messages/en";

const setVariantImageAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/products/actions", () => ({ setVariantImageAction }));

const { VariantImagePicker } = await import("./variant-image-picker");

const t = en.productMedia;
const image = (id: string, alt: string | null = null): ProductImageDto => ({
  id,
  url: `https://cdn.example.test/${id}.webp`,
  alt,
  width: 10,
  height: 10,
});
const media = [image("a", "Front"), image("b"), image("c", "Back")];

function renderPicker(current: string | null = null, list: readonly ProductImageDto[] = media) {
  return render(
    <VariantImagePicker
      productId="p1"
      variantId="v1"
      productName="Plush Bear"
      media={list}
      current={current}
      t={en}
    />,
  );
}
const group = () => screen.getByRole("radiogroup", { name: t.variantImage });
const radio = (name: string | RegExp) => within(group()).getByRole("radio", { name });

beforeEach(() => {
  vi.resetAllMocks();
  setVariantImageAction.mockResolvedValue({ status: "success" });
});

describe("VariantImagePicker (Plan 2C-3)", () => {
  it("offers None and each of the product's pictures, with the current choice checked", () => {
    renderPicker("b");
    expect(within(group()).getAllByRole("radio")).toHaveLength(4);
    expect(radio(t.variantImageNone)).toHaveAttribute("aria-checked", "false");
    expect(radio("Front")).toHaveAttribute("aria-checked", "false");
    expect(radio("Plush Bear")).toHaveAttribute("aria-checked", "true"); // b has no alt text: the title describes it
    expect(screen.getByText(t.variantImageHint)).toBeInTheDocument();
  });

  it("checks None when the variant has no image of its own", () => {
    renderPicker(null);
    expect(radio(t.variantImageNone)).toHaveAttribute("aria-checked", "true");
  });

  it("saves the chosen picture at once, through the variant-image action", async () => {
    renderPicker(null);
    fireEvent.click(radio("Back"));

    expect(radio("Back")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(setVariantImageAction).toHaveBeenCalledTimes(1));
    const form = setVariantImageAction.mock.calls[0]![1] as FormData;
    expect(form.get("productId")).toBe("p1");
    expect(form.get("variantId")).toBe("v1");
    expect(form.get("mediaId")).toBe("c");
  });

  it("clears the image with None (an empty media id)", async () => {
    renderPicker("a");
    fireEvent.click(radio(t.variantImageNone));
    await waitFor(() => expect(setVariantImageAction).toHaveBeenCalledTimes(1));
    expect((setVariantImageAction.mock.calls[0]![1] as FormData).get("mediaId")).toBe("");
    expect(radio(t.variantImageNone)).toHaveAttribute("aria-checked", "true");
  });

  it("goes back to the previous choice and says why when saving fails", async () => {
    setVariantImageAction.mockResolvedValue({ status: "error", message: "Nope", fieldErrors: {} });
    renderPicker("a");
    fireEvent.click(radio("Back"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
    expect(radio("Front")).toHaveAttribute("aria-checked", "true");
    expect(radio("Back")).toHaveAttribute("aria-checked", "false");
  });

  it("does nothing when the chosen picture is clicked again", () => {
    renderPicker("a");
    fireEvent.click(radio("Front"));
    expect(setVariantImageAction).not.toHaveBeenCalled();
  });

  it("renders nothing for a product that has no pictures", () => {
    const { container } = renderPicker(null, []);
    expect(container).toBeEmptyDOMElement();
  });
});
