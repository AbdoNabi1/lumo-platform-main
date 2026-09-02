import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Brand } from "./brand";
import { Slug } from "./value-objects/slug";

function slug(value = "acme"): Slug {
  const result = Slug.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Brand", () => {
  it("creates and emits brand.created", () => {
    const brand = Brand.create(
      UniqueEntityId.from("brand-1"),
      "Acme",
      slug(),
      "evt-1",
      new Date(0),
    );
    const events = brand.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("brand.created");
  });

  it("updates and emits brand.updated", () => {
    const brand = Brand.create(
      UniqueEntityId.from("brand-1"),
      "Acme",
      slug(),
      "evt-1",
      new Date(0),
    );
    brand.pullDomainEvents();
    brand.update("Acme Toys", "evt-2", new Date(0));
    expect(brand.name).toBe("Acme Toys");
    expect(brand.pullDomainEvents()[0]?.eventName).toBe("brand.updated");
  });

  it("deletes and emits brand.deleted; rejects deleting twice", () => {
    const brand = Brand.create(
      UniqueEntityId.from("brand-1"),
      "Acme",
      slug(),
      "evt-1",
      new Date(0),
    );
    brand.pullDomainEvents();
    brand.delete("evt-2", new Date(0));
    expect(brand.deleted).toBe(true);
    expect(brand.pullDomainEvents()[0]?.eventName).toBe("brand.deleted");
    expect(() => brand.delete("evt-3", new Date(0))).toThrow(BusinessRuleError);
  });
});
