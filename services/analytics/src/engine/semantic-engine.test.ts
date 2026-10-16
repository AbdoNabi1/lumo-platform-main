import { describe, expect, it } from "vitest";
import { registerFinanceSemantics } from "../infrastructure/finance-semantics";
import { InMemoryAnalyticsReadStore } from "../infrastructure/in-memory-analytics-read-store";
import { SemanticRegistry } from "../registry/semantic-registry";
import { SemanticEngine } from "./semantic-engine";

/**
 * End-to-end proof (mirrors the Sprint 3.2 report's own claim): `gross_margin` computed only in
 * the Core Engine, joining `finance.revenue` + `finance.profit` — not duplicated inside Finance.
 */
describe("SemanticEngine (Finance semantics, end-to-end)", () => {
  it("computes gross_margin = 60000 / 100000 = 0.6 across two read models", async () => {
    const registry = new SemanticRegistry();
    registerFinanceSemantics(registry);

    const store = new InMemoryAnalyticsReadStore();
    store.seed("finance.revenue", [
      { period: "2026-07", currency: "USD", grossMinor: 100000, refundsMinor: 0, netMinor: 100000 },
    ]);
    store.seed("finance.profit", [
      {
        period: "2026-07",
        currency: "USD",
        revenueMinor: 100000,
        cogsMinor: 40000,
        expensesMinor: 20000,
        grossProfitMinor: 60000,
        netProfitMinor: 40000,
      },
    ]);
    store.seed("finance.cogs", [{ period: "2026-07", currency: "USD", totalMinor: 40000 }]);
    store.seed("finance.expense", [{ period: "2026-07", currency: "USD", totalMinor: 20000 }]);

    const result = await SemanticEngine.execute(
      registry,
      store,
      { metricIds: ["finance.gross_margin"] },
      "tenant-a",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(1);
    expect(result.value.rows[0]!.metrics["finance.gross_margin"]).toBe(0.6);
  });

  it("computes EBIT (operating_profit) = revenue - cogs - expenses without a dedicated read model", async () => {
    const registry = new SemanticRegistry();
    registerFinanceSemantics(registry);

    const store = new InMemoryAnalyticsReadStore();
    store.seed("finance.revenue", [
      { period: "2026-07", currency: "USD", grossMinor: 100000, refundsMinor: 0, netMinor: 100000 },
    ]);
    store.seed("finance.cogs", [{ period: "2026-07", currency: "USD", totalMinor: 40000 }]);
    store.seed("finance.expense", [{ period: "2026-07", currency: "USD", totalMinor: 20000 }]);

    const result = await SemanticEngine.execute(
      registry,
      store,
      { metricIds: ["finance.operating_profit", "finance.operating_margin"] },
      "tenant-a",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]!.metrics["finance.operating_profit"]).toBe(40000);
    expect(result.value.rows[0]!.metrics["finance.operating_margin"]).toBe(0.4);
  });

  it("returns NotFound for an unregistered metric id, failing closed rather than returning 0 silently", async () => {
    const registry = new SemanticRegistry();
    registerFinanceSemantics(registry);
    const store = new InMemoryAnalyticsReadStore();

    const result = await SemanticEngine.execute(
      registry,
      store,
      { metricIds: ["finance.does_not_exist"] },
      "tenant-a",
    );
    expect(result.ok).toBe(false);
  });
});
