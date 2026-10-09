import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { BrandDto } from "@/lib/api/brands";
import { OrganizationCard } from "./organization-card";

const t = en.productEditor;

const brands: readonly BrandDto[] = [
  { id: "b1", name: "Acme Toys", slug: "acme-toys" },
  { id: "b2", name: "Nile Kids", slug: "nile-kids" },
];

function renderCard(overrides: Partial<Parameters<typeof OrganizationCard>[0]> = {}) {
  return render(
    <form id="product-editor">
      <OrganizationCard
        productType=""
        brandId={null}
        categoryIds={[]}
        tags={[]}
        brands={brands}
        categories={[]}
        errors={{}}
        t={en}
        {...overrides}
      />
    </form>,
  );
}

const formData = (container: HTMLElement) => new FormData(container.querySelector("form")!);

describe("OrganizationCard", () => {
  it("types the vendor freely, suggesting the brands, and starts on the product's own brand", () => {
    const { container } = renderCard({ brandId: "b2" });

    const vendor = screen.getByLabelText(t.brand);
    expect(vendor).toHaveAttribute("name", "vendor");
    expect(vendor).toHaveAttribute("form", "product-editor");
    expect(vendor).toHaveValue("Nile Kids");
    const list = container.querySelector(`datalist[id="${vendor.getAttribute("list")}"]`);
    expect(list).not.toBeNull();
    expect(
      Array.from(list!.querySelectorAll("option")).map((option) => option.getAttribute("value")),
    ).toEqual(["Acme Toys", "Nile Kids"]);
    expect(formData(container).get("vendorKeep")).toBeNull();
  });

  it("starts blank for a product without a brand", () => {
    renderCard();

    expect(screen.getByLabelText(t.brand)).toHaveValue("");
  });

  it("flags a brand it cannot name, so a blank vendor does not drop it", () => {
    const { container } = renderCard({ brandId: "far-away" });

    expect(screen.getByLabelText(t.brand)).toHaveValue("");
    expect(formData(container).get("vendorKeep")).toBe("1");
  });

  it("shows the tags as chips and posts them comma-joined under the same name", () => {
    const { container } = renderCard({ tags: ["summer", "sale"] });

    expect(
      screen.getByRole("button", { name: t.removeTag.replace("{tag}", "summer") }),
    ).toBeInTheDocument();
    expect(formData(container).get("tags")).toBe("summer, sale");

    fireEvent.change(screen.getByLabelText(t.tags), { target: { value: "new," } });
    expect(formData(container).get("tags")).toBe("summer, sale, new");
  });

  it("keeps the type and category fields as they were", () => {
    const { container } = renderCard({
      productType: "Toy",
      categoryIds: ["c1"],
      categories: [{ id: "c1", name: "Toys", slug: "toys", parentId: null }],
    });

    expect(screen.getByLabelText(t.productType)).toHaveValue("Toy");
    expect(formData(container).getAll("categoryIds")).toEqual(["c1"]);
  });
});
