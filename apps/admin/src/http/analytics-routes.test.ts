import { describe, expect, it } from "vitest";
import {
  CalculatedMetric,
  CanonicalId,
  DimensionDefinition,
  Measure,
  SemanticBinding,
  defineAggregation,
  defineMetricUnit,
  literalExpr,
  MetricDefinition,
} from "@platform/analytics";
import type { WiredAdmin } from "../composition";
import { analyticsRoutes } from "./analytics-routes";

/**
 * Regression guard for the Analytics admin read surface's DTO boundary. `AnalyticsConsoleController`
 * presents raw `Metric`/`DimensionDefinition` value objects (see its own doc comment) — `ValueObject`
 * stores data under a `protected` `props` field that TypeScript erases only at compile time, so
 * returning one verbatim serializes as `{"props": {...}}`, nesting every field one level deeper than
 * any consumer expects. These tests pin the flat DTO boundary `toMetricDto`/`toDimensionDto` add.
 */

function unwrap(id: string): CanonicalId {
  const result = CanonicalId.define(id);
  if (!result.ok) throw new Error(`invalid canonical id ${id}`);
  return result.value;
}

function buildMetricDefinition(): MetricDefinition {
  const measure = Measure.define(
    unwrap("finance.gross_revenue"),
    okOrThrow(defineAggregation("sum")),
    okOrThrow(SemanticBinding.define(unwrap("finance.orders"), "total_amount_minor")),
  );
  const definition = MetricDefinition.define(
    unwrap("finance.gross_revenue"),
    okOrThrow(defineMetricUnit("currency")),
    "Gross revenue across all orders",
    okOrThrow(measure),
  );
  return okOrThrow(definition);
}

function buildCalculatedMetric(): CalculatedMetric {
  const calculated = CalculatedMetric.define(
    unwrap("finance.flat_fee"),
    okOrThrow(defineMetricUnit("currency")),
    "A flat, non-measured fee",
    literalExpr(500),
  );
  return okOrThrow(calculated);
}

function buildDimension(): DimensionDefinition {
  const dimension = DimensionDefinition.define(
    unwrap("finance.order_status"),
    "Order status",
    okOrThrow(SemanticBinding.define(unwrap("finance.orders"), "status")),
  );
  return okOrThrow(dimension);
}

function okOrThrow<T>(result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown }): T {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value as T;
}

async function invoke(admin: WiredAdmin, path: string): Promise<{ status: number; body: unknown }> {
  const route = analyticsRoutes(admin).find((r) => r.path === path);
  if (route === undefined) throw new Error(`no analytics route at ${path}`);
  return (await route.handle({
    body: undefined,
    params: undefined,
    query: {},
    context: {
      tenantId: "tenant-local",
      principal: { id: "staff-1", kind: "staff", roles: ["admin"] },
      requestId: "req-1",
    },
  } as never)) as { status: number; body: unknown };
}

describe("analytics routes — DTO boundary", () => {
  it("flattens a base metric definition to a primitive-only DTO", async () => {
    const admin = {
      analytics: {
        listMetrics: async () => ({ status: 200, body: [buildMetricDefinition()] }),
      },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/analytics/metrics");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: "finance.gross_revenue",
        kind: "definition",
        unit: "currency",
        description: "Gross revenue across all orders",
        measure: {
          id: "finance.gross_revenue",
          aggregation: "sum",
          readModelId: "finance.orders",
          physicalField: "total_amount_minor",
        },
      },
    ]);
  });

  it("flattens a calculated metric to its expression, not its measure", async () => {
    const admin = {
      analytics: {
        listMetrics: async () => ({ status: 200, body: [buildCalculatedMetric()] }),
      },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/analytics/metrics");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: "finance.flat_fee",
        kind: "calculated",
        unit: "currency",
        description: "A flat, non-measured fee",
        expression: { kind: "literal", value: 500 },
      },
    ]);
  });

  it("flattens a dimension definition to a primitive-only DTO", async () => {
    const admin = {
      analytics: {
        listDimensions: async () => ({ status: 200, body: [buildDimension()] }),
      },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/analytics/dimensions");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: "finance.order_status",
        label: "Order status",
        readModelId: "finance.orders",
        physicalField: "status",
      },
    ]);
  });

  it("never puts the value object's internal `props` field on the wire", async () => {
    const admin = {
      analytics: {
        listMetrics: async () => ({ status: 200, body: [buildMetricDefinition()] }),
      },
    } as unknown as WiredAdmin;

    const serialized = JSON.stringify(await invoke(admin, "/analytics/metrics"));

    expect(serialized).not.toContain("props");
  });

  it("passes a non-2xx body through untouched — an error envelope is not a metric", async () => {
    const envelope = { code: "NOT_FOUND", message: "Metric \"x\" not found" };
    const admin = {
      analytics: {
        getMetric: async () => ({ status: 404, body: envelope }),
      },
    } as unknown as WiredAdmin;

    const response = await invoke(admin, "/analytics/metrics/:id");

    expect(response.status).toBe(404);
    expect(response.body).toBe(envelope);
  });
});
