import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { RecommendationModel } from "./recommendation-model";
import { RecommendationStrategy } from "./value-objects/recommendation-strategy";

function strategy(): RecommendationStrategy {
  const result = RecommendationStrategy.create("related");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function model(): RecommendationModel {
  return RecommendationModel.create(UniqueEntityId.from("model-1"), "related-products", strategy());
}

describe("RecommendationModel", () => {
  it("starts at draft", () => {
    const m = model();
    expect(m.status.value).toBe("draft");
    expect(m.sets).toHaveLength(0);
  });

  it("generates a set once active, idempotently per anchor", () => {
    const m = model();
    m.startTraining("evt-1", new Date(0));
    m.activate("evt-2", new Date(0));
    m.generate("product-1", [{ productRef: "product-2", score: 0.9 }], "evt-3", new Date(0));
    expect(m.sets).toHaveLength(1);
    m.generate("product-1", [{ productRef: "product-3", score: 0.5 }], "evt-4", new Date(0));
    expect(m.sets).toHaveLength(1);
    expect(m.sets[0]?.scoredRefs[0]?.productRef).toBe("product-2");
  });

  it("regenerates (overwrites) the set for an anchor", () => {
    const m = model();
    m.startTraining("evt-1", new Date(0));
    m.activate("evt-2", new Date(0));
    m.generate("product-1", [{ productRef: "product-2", score: 0.9 }], "evt-3", new Date(0));
    m.regenerate("product-1", [{ productRef: "product-3", score: 0.5 }], "evt-4", new Date(0));
    expect(m.sets).toHaveLength(1);
    expect(m.sets[0]?.scoredRefs[0]?.productRef).toBe("product-3");
  });

  it("rejects generation while not active", () => {
    const m = model();
    expect(() => m.generate("product-1", [], "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (draft -> active directly, 409)", () => {
    const m = model();
    expect(() => m.transition("active", "evt-1", new Date(0))).toThrow(BusinessRuleError);
  });
});
