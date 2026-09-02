import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Collection } from "./collection";
import { Slug } from "./value-objects/slug";

function slug(value = "summer-sale"): Slug {
  const result = Slug.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function collectionFixture(): Collection {
  return Collection.create(
    UniqueEntityId.from("col-1"),
    "Summer Sale",
    slug(),
    "evt-0",
    new Date(0),
  );
}

describe("Collection", () => {
  it("creates as draft, empty, and emits collection.created", () => {
    const collection = collectionFixture();
    expect(collection.status).toBe("draft");
    expect(collection.productIds).toHaveLength(0);
    const events = collection.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("collection.created");
  });

  it("renames and emits collection.renamed", () => {
    const collection = collectionFixture();
    collection.pullDomainEvents();
    collection.rename("Winter Sale", "evt-1", new Date(0));
    expect(collection.name).toBe("Winter Sale");
    expect(collection.pullDomainEvents()[0]?.eventName).toBe("collection.renamed");
  });

  it("adds/removes products, rejecting duplicates and unknown removals", () => {
    const collection = collectionFixture();
    collection.pullDomainEvents();
    collection.addProduct("p-1", "evt-1", new Date(0));
    collection.addProduct("p-2", "evt-2", new Date(0));
    expect(collection.productIds).toEqual(["p-1", "p-2"]);
    expect(() => collection.addProduct("p-1", "evt-3", new Date(0))).toThrow(BusinessRuleError);

    collection.removeProduct("p-1", "evt-4", new Date(0));
    expect(collection.productIds).toEqual(["p-2"]);
    expect(() => collection.removeProduct("p-1", "evt-5", new Date(0))).toThrow(BusinessRuleError);
  });

  it("reorders products via an exact permutation only", () => {
    const collection = collectionFixture();
    collection.addProduct("p-1", "evt-1", new Date(0));
    collection.addProduct("p-2", "evt-2", new Date(0));
    collection.addProduct("p-3", "evt-3", new Date(0));
    collection.pullDomainEvents();

    collection.reorderProducts(["p-3", "p-1", "p-2"], "evt-4", new Date(0));
    expect(collection.productIds).toEqual(["p-3", "p-1", "p-2"]);
    expect(collection.pullDomainEvents()[0]?.eventName).toBe("collection.products_reordered");

    expect(() => collection.reorderProducts(["p-1", "p-2"], "evt-5", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("publishes and unpublishes", () => {
    const collection = collectionFixture();
    collection.pullDomainEvents();
    collection.publish("evt-1", new Date(0));
    expect(collection.status).toBe("published");
    expect(collection.pullDomainEvents()[0]?.eventName).toBe("collection.published");

    expect(() => collection.publish("evt-2", new Date(0))).toThrow(BusinessRuleError);

    collection.unpublish("evt-3", new Date(0));
    expect(collection.status).toBe("draft");
    expect(collection.pullDomainEvents()[0]?.eventName).toBe("collection.unpublished");
    expect(() => collection.unpublish("evt-4", new Date(0))).toThrow(BusinessRuleError);
  });

  it("deletes and emits collection.deleted; rejects deleting twice", () => {
    const collection = collectionFixture();
    collection.pullDomainEvents();
    collection.delete("evt-1", new Date(0));
    expect(collection.deleted).toBe(true);
    expect(collection.pullDomainEvents()[0]?.eventName).toBe("collection.deleted");
    expect(() => collection.delete("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
