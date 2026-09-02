import { describe, expect, it } from "vitest";
import { Entity } from "./entity";
import { UniqueEntityId } from "../value-object/unique-entity-id";

interface ProductProps {
  name: string;
}

class Product extends Entity<ProductProps> {
  static create(name: string, id: UniqueEntityId): Product {
    return new Product({ name }, id);
  }

  get name(): string {
    return this.props.name;
  }
}

describe("Entity", () => {
  it("exposes its identity", () => {
    const product = Product.create("stacker", UniqueEntityId.from("p-1"));
    expect(product.id.value).toBe("p-1");
    expect(product.name).toBe("stacker");
  });

  it("is equal by identity regardless of attributes", () => {
    const id = UniqueEntityId.from("p-1");
    expect(Product.create("a", id).equals(Product.create("b", id))).toBe(true);
  });

  it("is not equal when identities differ", () => {
    const a = Product.create("a", UniqueEntityId.from("p-1"));
    const b = Product.create("a", UniqueEntityId.from("p-2"));
    expect(a.equals(b)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
  });
});
