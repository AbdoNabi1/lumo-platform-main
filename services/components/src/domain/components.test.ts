import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { ComponentDefinition } from "./component-definition";
import { ComponentContract } from "./value-objects/component-contract";
import { ComponentSchema } from "./value-objects/component-schema";

function definition(): ComponentDefinition {
  return ComponentDefinition.create(
    UniqueEntityId.from("component-1"),
    "hero",
    "Hero",
    ComponentSchema.create([{ name: "title", type: "string", required: true }]),
    ComponentContract.create({ slots: ["content"], events: ["onClick"], responsive: true }),
  );
}

describe("ComponentDefinition", () => {
  it("starts at draft", () => {
    expect(definition().status).toBe("draft");
  });

  it("publishes, then deprecates, then archives", () => {
    const c = definition();
    c.publish("evt-1", new Date(0));
    expect(c.status).toBe("published");
    c.deprecate("evt-2", new Date(0));
    expect(c.status).toBe("deprecated");
    c.archive("evt-3", new Date(0));
    expect(c.status).toBe("archived");
  });

  it("rejects an illegal transition (draft -> deprecated, 409)", () => {
    const c = definition();
    expect(() => c.transition("deprecated", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
