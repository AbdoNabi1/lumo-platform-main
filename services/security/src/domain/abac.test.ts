import { describe, expect, it } from "vitest";
import { AttributeEvaluator } from "./abac";

describe("AttributeEvaluator (ABAC)", () => {
  const evaluator = new AttributeEvaluator();
  const context = {
    principal: { department: "eng", clearance: "high" },
    resource: { classification: "confidential" },
    environment: { network: "corp" },
  };

  it("is satisfied when all specified attributes match", () => {
    const result = evaluator.evaluate(
      { principal: { department: "eng" }, resource: { classification: "confidential" } },
      context,
    );
    expect(result.satisfied).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reports mismatches for explanation", () => {
    const result = evaluator.evaluate(
      { principal: { department: "sales" }, environment: { network: "vpn" } },
      context,
    );
    expect(result.satisfied).toBe(false);
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        { dimension: "principal", attribute: "department", expected: "sales", actual: "eng" },
        { dimension: "environment", attribute: "network", expected: "vpn", actual: "corp" },
      ]),
    );
  });

  it("holds vacuously for an empty condition", () => {
    expect(evaluator.evaluate({}, context).satisfied).toBe(true);
  });
});
