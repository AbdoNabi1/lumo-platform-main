import { describe, expect, it } from "vitest";
import { NotFoundError, BusinessRuleError } from "@platform/utils";
import { CanonicalId } from "../domain/value-objects/canonical-id";
import { ReadModelDescriptor } from "../domain/read-model-descriptor";
import { SemanticBinding } from "../domain/semantic-binding";
import { CalculatedMetric, Measure, MetricDefinition } from "../domain/semantic-model";
import {
  addExpr,
  divideExpr,
  literalExpr,
  refExpr,
} from "../domain/value-objects/metric-expression";
import { SemanticRegistry } from "../registry/semantic-registry";
import { MetricDependencyResolver } from "./metric-dependency-resolver";

function id(value: string): CanonicalId {
  const result = CanonicalId.define(value);
  if (!result.ok) throw new Error("bad fixture id");
  return result.value;
}

function buildRegistry(): SemanticRegistry {
  const registry = new SemanticRegistry();
  const rm = ReadModelDescriptor.define(id("test.rm"), ["key", "value"], "key");
  if (!rm.ok) throw new Error("bad fixture read model");
  registry.readModels.register(rm.value);

  const binding = SemanticBinding.define(rm.value.id, "value");
  if (!binding.ok) throw new Error("bad fixture binding");

  const measure = Measure.define(id("test.a"), "sum", binding.value);
  if (!measure.ok) throw new Error("bad fixture measure");
  const baseA = MetricDefinition.define(id("test.a"), "count", "base A", measure.value);
  if (!baseA.ok) throw new Error("bad fixture metric");
  registry.metrics.register(baseA.value);

  const calcB = CalculatedMetric.define(
    id("test.b"),
    "count",
    "B = A + 1",
    addExpr(refExpr("test.a"), literalExpr(1)),
  );
  if (!calcB.ok) throw new Error("bad fixture metric");
  registry.metrics.register(calcB.value);

  const calcC = CalculatedMetric.define(
    id("test.c"),
    "ratio",
    "C = B / A",
    divideExpr(refExpr("test.b"), refExpr("test.a")),
  );
  if (!calcC.ok) throw new Error("bad fixture metric");
  registry.metrics.register(calcC.value);

  const cycleX = CalculatedMetric.define(
    id("test.x"),
    "count",
    "X = Y + 1",
    addExpr(refExpr("test.y"), literalExpr(1)),
  );
  const cycleY = CalculatedMetric.define(
    id("test.y"),
    "count",
    "Y = X + 1",
    addExpr(refExpr("test.x"), literalExpr(1)),
  );
  if (!cycleX.ok || !cycleY.ok) throw new Error("bad fixture metric");
  registry.metrics.register(cycleX.value);
  registry.metrics.register(cycleY.value);

  const missing = CalculatedMetric.define(
    id("test.m"),
    "count",
    "M refs nonexistent",
    refExpr("test.nonexistent"),
  );
  if (!missing.ok) throw new Error("bad fixture metric");
  registry.metrics.register(missing.value);

  return registry;
}

describe("MetricDependencyResolver", () => {
  it("orders base metrics before the calculated metrics that reference them", () => {
    const registry = buildRegistry();
    const resolved = MetricDependencyResolver.resolveOrder(registry, ["test.c"]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const ids = resolved.value.map((metric) => metric.id.value);
    expect(ids.indexOf("test.a")).toBeLessThan(ids.indexOf("test.b"));
    expect(ids.indexOf("test.b")).toBeLessThan(ids.indexOf("test.c"));
  });

  it("detects a dependency cycle and fails closed", () => {
    const registry = buildRegistry();
    const resolved = MetricDependencyResolver.resolveOrder(registry, ["test.x"]);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBeInstanceOf(BusinessRuleError);
  });

  it("detects a missing metric reference and fails closed", () => {
    const registry = buildRegistry();
    const resolved = MetricDependencyResolver.resolveOrder(registry, ["test.m"]);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBeInstanceOf(NotFoundError);
  });

  it("reports NotFound for a top-level unregistered metric id", () => {
    const registry = buildRegistry();
    const resolved = MetricDependencyResolver.resolveOrder(registry, ["does.not.exist"]);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBeInstanceOf(NotFoundError);
  });
});
