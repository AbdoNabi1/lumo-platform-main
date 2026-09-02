import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Category } from "./category";
import { Slug } from "./value-objects/slug";

function slug(value: string): Slug {
  const result = Slug.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Category", () => {
  it("creates (optionally under a parent) and emits category.created", () => {
    const category = Category.create(
      UniqueEntityId.from("cat-1"),
      "Toys",
      slug("toys"),
      null,
      "evt-1",
      new Date(0),
    );
    expect(category.parentId).toBeNull();
    const events = category.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("category.created");
  });

  it("moves to a new parent and emits category.moved", () => {
    const category = Category.create(
      UniqueEntityId.from("cat-1"),
      "Toys",
      slug("toys"),
      null,
      "evt-1",
      new Date(0),
    );
    category.pullDomainEvents();
    category.moveTo("cat-parent", [], "evt-2", new Date(0));
    expect(category.parentId).toBe("cat-parent");
    expect(category.pullDomainEvents()[0]?.eventName).toBe("category.moved");
  });

  it("rejects becoming its own ancestor (direct and transitive)", () => {
    const category = Category.create(
      UniqueEntityId.from("cat-1"),
      "Toys",
      slug("toys"),
      null,
      "evt-1",
      new Date(0),
    );
    expect(() => category.moveTo("cat-1", [], "evt-2", new Date(0))).toThrow(BusinessRuleError);
    expect(() => category.moveTo("cat-2", ["cat-2", "cat-1"], "evt-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });

  it("deletes and emits category.deleted; rejects deleting twice", () => {
    const category = Category.create(
      UniqueEntityId.from("cat-1"),
      "Toys",
      slug("toys"),
      null,
      "evt-1",
      new Date(0),
    );
    category.pullDomainEvents();
    category.delete("evt-2", new Date(0));
    expect(category.deleted).toBe(true);
    expect(category.pullDomainEvents()[0]?.eventName).toBe("category.deleted");
    expect(() => category.delete("evt-3", new Date(0))).toThrow(BusinessRuleError);
  });
});
