import { describe, expect, it } from "vitest";
import { BusinessRuleError, Money, UniqueEntityId } from "@platform/domain";
import { Product } from "./product";
import { PublishState } from "./value-objects/publish-state";
import { Sku } from "./value-objects/sku";
import { Slug } from "./value-objects/slug";
import { Variant } from "./variant";

function productFixture(): Product {
  const sku = Sku.create("P-1");
  const slug = Slug.create("toy-wagon");
  const price = Money.create(1999, "USD");
  if (!sku.ok || !slug.ok || !price.ok) throw new Error("invalid fixture");
  const variantSku = Sku.create("SKU-1");
  if (!variantSku.ok) throw new Error("invalid fixture");
  const product = Product.create(
    UniqueEntityId.from("product-1"),
    {
      sku: sku.value,
      name: "Toy Wagon",
      slug: slug.value,
      variants: [Variant.create(UniqueEntityId.from("variant-1"), variantSku.value, price.value)],
    },
    "evt-0",
    new Date(0),
  );
  product.pullDomainEvents();
  return product;
}

describe("Product unlisted status (Plan 2C-1)", () => {
  it("unlisting a draft makes it sellable but not listed, and raises no event", () => {
    const product = productFixture();
    product.unlist("evt-1", new Date(0));
    expect(product.status.value).toBe("unlisted");
    expect(product.status.isSellable).toBe(true);
    expect(product.status.isListed).toBe(false);
    expect(product.pullDomainEvents()).toHaveLength(0);
  });

  it("unlisting a published product raises product.unpublished (it left every listing)", () => {
    const product = productFixture();
    product.publish("evt-1", new Date(0));
    product.pullDomainEvents();
    product.unlist("evt-2", new Date(0));
    expect(product.status.isUnlisted).toBe(true);
    const events = product.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("product.unpublished");
  });

  it("an unlisted product can be published, raising product.published", () => {
    const product = productFixture();
    product.unlist("evt-1", new Date(0));
    product.pullDomainEvents();
    product.publish("evt-2", new Date(0));
    expect(product.status.isPublished).toBe(true);
    const events = product.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("product.published");
  });

  it("an unlisted product can be unpublished to draft without an event (never listed)", () => {
    const product = productFixture();
    product.unlist("evt-1", new Date(0));
    product.pullDomainEvents();
    product.unpublish("evt-2", new Date(0));
    expect(product.status.isDraft).toBe(true);
    expect(product.pullDomainEvents()).toHaveLength(0);
  });

  it("refuses to unlist an unlisted or an archived product", () => {
    const unlisted = productFixture();
    unlisted.unlist("evt-1", new Date(0));
    expect(() => unlisted.unlist("evt-2", new Date(0))).toThrow(BusinessRuleError);

    const archived = productFixture();
    archived.archive("evt-1", new Date(0));
    expect(() => archived.unlist("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("PublishState exposes isSellable and isListed", () => {
    expect(PublishState.from("unlisted").isSellable).toBe(true);
    expect(PublishState.published().isListed).toBe(true);
    expect(PublishState.published().isSellable).toBe(true);
    expect(PublishState.draft().isSellable).toBe(false);
    expect(PublishState.from("unlisted").isListed).toBe(false);
  });
});
