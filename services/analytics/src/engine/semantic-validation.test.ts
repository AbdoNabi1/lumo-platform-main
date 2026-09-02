import { describe, expect, it } from "vitest";
import { CanonicalId } from "../domain/value-objects/canonical-id";
import { ReadModelDescriptor } from "../domain/read-model-descriptor";
import { SemanticBinding } from "../domain/semantic-binding";
import { CalculatedMetric, Measure, MetricDefinition } from "../domain/semantic-model";
import { refExpr } from "../domain/value-objects/metric-expression";
import { SemanticRegistry } from "../registry/semantic-registry";
import { SemanticValidation } from "./semantic-validation";

function id(value: string): CanonicalId {
  const result = CanonicalId.define(value);
  if (!result.ok) throw new Error("bad fixture id");
  return result.value;
}

describe("SemanticValidation", () => {
  it("passes a registry whose bindings and references are all consistent", () => {
    const registry = new SemanticRegistry();
    const rm = ReadModelDescriptor.define(id("test.rm"), ["key", "value"], "key");
    if (!rm.ok) throw new Error("bad fixture");
    registry.readModels.register(rm.value);

    const binding = SemanticBinding.define(rm.value.id, "value");
    if (!binding.ok) throw new Error("bad fixture");
    const measure = Measure.define(id("test.a"), "sum", binding.value);
    if (!measure.ok) throw new Error("bad fixture");
    const base = MetricDefinition.define(id("test.a"), "count", "base", measure.value);
    if (!base.ok) throw new Error("bad fixture");
    registry.metrics.register(base.value);

    const calc = CalculatedMetric.define(id("test.b"), "count", "derived", refExpr("test.a"));
    if (!calc.ok) throw new Error("bad fixture");
    registry.metrics.register(calc.value);

    expect(SemanticValidation.validateRegistry(registry).ok).toBe(true);
  });

  it("fails closed, collecting every issue, when bindings/references are broken", () => {
    const registry = new SemanticRegistry();
    const rm = ReadModelDescriptor.define(id("test.rm"), ["key", "value"], "key");
    if (!rm.ok) throw new Error("bad fixture");
    registry.readModels.register(rm.value);

    // Measure bound to a field the read model does not declare.
    const badFieldBinding = SemanticBinding.define(rm.value.id, "nonexistent_field");
    if (!badFieldBinding.ok) throw new Error("bad fixture");
    const badMeasure = Measure.define(id("test.bad_field"), "sum", badFieldBinding.value);
    if (!badMeasure.ok) throw new Error("bad fixture");
    const badFieldMetric = MetricDefinition.define(
      id("test.bad_field"),
      "count",
      "bad",
      badMeasure.value,
    );
    if (!badFieldMetric.ok) throw new Error("bad fixture");
    registry.metrics.register(badFieldMetric.value);

    // Measure bound to a read model that was never registered.
    const unregisteredRmId = id("test.unregistered_rm");
    const badRmBinding = SemanticBinding.define(unregisteredRmId, "value");
    if (!badRmBinding.ok) throw new Error("bad fixture");
    const badRmMeasure = Measure.define(id("test.bad_rm"), "sum", badRmBinding.value);
    if (!badRmMeasure.ok) throw new Error("bad fixture");
    const badRmMetric = MetricDefinition.define(
      id("test.bad_rm"),
      "count",
      "bad",
      badRmMeasure.value,
    );
    if (!badRmMetric.ok) throw new Error("bad fixture");
    registry.metrics.register(badRmMetric.value);

    // Calculated metric referencing an id that was never registered.
    const danglingCalc = CalculatedMetric.define(
      id("test.dangling"),
      "count",
      "dangling",
      refExpr("test.ghost"),
    );
    if (!danglingCalc.ok) throw new Error("bad fixture");
    registry.metrics.register(danglingCalc.value);

    const result = SemanticValidation.validateRegistry(registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fields.length).toBe(3);
  });
});
