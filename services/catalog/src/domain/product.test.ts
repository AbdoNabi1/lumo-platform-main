import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId } from "@platform/domain";
import { Product } from "./product";
import { CategoryRef } from "./value-objects/category-ref";
import { MediaRef } from "./value-objects/media-ref";
import { ProductOption } from "./value-objects/product-option";
import { Sku } from "./value-objects/sku";
import { Slug } from "./value-objects/slug";
import { VariantSelection } from "./value-objects/variant-selection";
import { Variant } from "./variant";

function sku(value: string): Sku {
  const result = Sku.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function money(amountMinor: number, currency = "USD"): Money {
  const result = Money.create(amountMinor, currency);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function mediaRef(assetId: string): MediaRef {
  const result = MediaRef.create(assetId);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function categoryRef(categoryId: string): CategoryRef {
  const result = CategoryRef.create(categoryId);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function variantFixture(id = "variant-1", skuValue = "SKU-1"): Variant {
  return Variant.create(UniqueEntityId.from(id), sku(skuValue), money(1999));
}

function productFixture(): Product {
  const sku = Sku.create("P-1");
  const slug = Slug.create("toy-wagon");
  if (!sku.ok || !slug.ok) throw new Error("invalid fixture");
  return Product.create(
    UniqueEntityId.from("product-1"),
    { sku: sku.value, name: "Toy Wagon", slug: slug.value, variants: [variantFixture()] },
    "evt-0",
    new Date(0),
  );
}

describe("Product", () => {
  it("is created as a draft and emits product.created", () => {
    const product = productFixture();
    expect(product.status.value).toBe("draft");
    const events = product.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("product.created");
  });

  it("publishes and emits product.published", () => {
    const product = productFixture();
    product.pullDomainEvents();
    product.publish("evt-1", new Date("2026-06-30T00:00:00.000Z"));

    expect(product.status.isPublished).toBe(true);
    const events = product.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("product.published");
  });

  it("rejects publishing twice", () => {
    const product = productFixture();
    product.publish("evt-1", new Date(0));
    product.pullDomainEvents();
    expect(() => product.publish("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects publishing an archived product", () => {
    const product = productFixture();
    product.archive("evt-1", new Date(0));
    expect(() => product.publish("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("requires at least one variant", () => {
    const sku = Sku.create("P-2");
    const slug = Slug.create("empty");
    if (!sku.ok || !slug.ok) throw new Error("invalid fixture");
    expect(() =>
      Product.create(
        UniqueEntityId.from("product-2"),
        { sku: sku.value, name: "Empty", slug: slug.value, variants: [] },
        "evt-0",
        new Date(0),
      ),
    ).toThrow(BusinessRuleError);
  });

  it("updates and emits product.updated", () => {
    const product = productFixture();
    product.pullDomainEvents();
    const slug = Slug.create("new-slug");
    if (!slug.ok) throw new Error("invalid fixture");
    product.update("New Name", slug.value, "evt-3", new Date(0));

    expect(product.name).toBe("New Name");
    expect(product.pullDomainEvents()[0]?.eventName).toBe("product.updated");
  });

  // -- Commerce Sprint 1: publish state machine, variant matrix, categories -------------------

  it("schedules a future publish (draft only) and rejects a non-future date", () => {
    const product = productFixture();
    const now = new Date("2026-07-01T00:00:00.000Z");
    product.schedulePublish(new Date("2026-08-01T00:00:00.000Z"), now);
    expect(product.status.isScheduled).toBe(true);

    const other = productFixture();
    expect(() => other.schedulePublish(new Date("2026-06-01T00:00:00.000Z"), now)).toThrow(
      BusinessRuleError,
    );
  });

  it("unpublishes a published product back to draft", () => {
    const product = productFixture();
    product.publish("evt-1", new Date(0));
    product.pullDomainEvents();
    product.unpublish("evt-2", new Date(0));
    expect(product.status.isDraft).toBe(true);
    expect(product.pullDomainEvents()[0]?.eventName).toBe("product.unpublished");
  });

  it("rejects unpublishing a draft product", () => {
    const product = productFixture();
    expect(() => product.unpublish("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("archives and emits product.archived", () => {
    const product = productFixture();
    product.pullDomainEvents();
    product.archive("evt-1", new Date(0));
    expect(product.status.isArchived).toBe(true);
    expect(product.pullDomainEvents()[0]?.eventName).toBe("product.archived");
  });

  it("adds a variant consistent with declared options and rejects a duplicate selection", () => {
    const product = productFixture();
    const option = ProductOption.create("Color", ["Red", "Blue"]);
    if (!option.ok) throw new Error("invalid fixture");
    product.setOptions([option.value]);
    product.pullDomainEvents();

    const redSelection = VariantSelection.create({ Color: "Red" });
    if (!redSelection.ok) throw new Error("invalid fixture");
    const red = Variant.create(
      UniqueEntityId.from("v-red"),
      sku("SKU-RED"),
      money(500),
      redSelection.value,
    );
    product.addVariant(red, "evt-1", new Date(0));
    expect(product.pullDomainEvents()[0]?.eventName).toBe("product.variant_added");

    const duplicate = Variant.create(
      UniqueEntityId.from("v-red-2"),
      sku("SKU-RED-2"),
      money(600),
      redSelection.value,
    );
    expect(() => product.addVariant(duplicate, "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects a variant selection that doesn't match a declared option", () => {
    const product = productFixture();
    const option = ProductOption.create("Color", ["Red"]);
    if (!option.ok) throw new Error("invalid fixture");
    product.setOptions([option.value]);

    const badSelection = VariantSelection.create({ Color: "Green" });
    if (!badSelection.ok) throw new Error("invalid fixture");
    const variant = Variant.create(
      UniqueEntityId.from("v-bad"),
      sku("SKU-BAD"),
      money(500),
      badSelection.value,
    );
    expect(() => product.addVariant(variant, "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("removes a variant but keeps at least one", () => {
    const product = productFixture();
    const second = variantFixture("variant-2", "SKU-2");
    product.addVariant(second, "evt-1", new Date(0));
    product.pullDomainEvents();

    product.removeVariant("variant-2", "evt-2", new Date(0));
    expect(product.variants).toHaveLength(1);
    expect(() => product.removeVariant("variant-1", "evt-3", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("options are mutable only while draft", () => {
    const product = productFixture();
    product.publish("evt-1", new Date(0));
    const option = ProductOption.create("Size", ["S", "M"]);
    if (!option.ok) throw new Error("invalid fixture");
    expect(() => product.setOptions([option.value])).toThrow(BusinessRuleError);
  });

  it("assigns categories and emits product.categorized", () => {
    const product = productFixture();
    product.pullDomainEvents();
    product.assignCategories([categoryRef("cat-1")], "evt-1", new Date(0));
    expect(product.pullDomainEvents()[0]?.eventName).toBe("product.categorized");
  });

  // -- Sprint 4.2: media lifecycle --------------------------------------------------------------

  it("attaches, detaches, and reorders media", () => {
    const product = productFixture();
    product.pullDomainEvents();

    product.attachMedia(mediaRef("asset-1"), "evt-1", new Date(0));
    product.attachMedia(mediaRef("asset-2"), "evt-2", new Date(0));
    expect(product.media.map((m) => m.assetId)).toEqual(["asset-1", "asset-2"]);
    expect(product.pullDomainEvents()).toHaveLength(2);

    expect(() => product.attachMedia(mediaRef("asset-1"), "evt-3", new Date(0))).toThrow(
      BusinessRuleError,
    );

    product.reorderMedia(["asset-2", "asset-1"], "evt-4", new Date(0));
    expect(product.media.map((m) => m.assetId)).toEqual(["asset-2", "asset-1"]);

    product.detachMedia("asset-2", "evt-5", new Date(0));
    expect(product.media.map((m) => m.assetId)).toEqual(["asset-1"]);
  });
});
