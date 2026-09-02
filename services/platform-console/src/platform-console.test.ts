import { describe, expect, it } from "vitest";
import { wirePlatformConsole } from "./composition";

describe("platform-console", () => {
  it("starts at the zero-state snapshot", async () => {
    const app = wirePlatformConsole();
    const response = await app.platformConsole.getKpis();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tenantCount: 0, mrr: 0 });
  });

  it("projects tenant/subscription/invoice/usage events into KPIs", async () => {
    const app = wirePlatformConsole();
    app.ingest("tenancy.tenant.created", {});
    app.ingest("licensing.subscription.started", {});
    app.ingest("licensing.invoice.paid", { amount: 2900 });
    app.ingest("platform.usage.recorded", { resource: "AI_TOKEN", amount: 100 });

    const response = await app.platformConsole.getKpis();
    expect(response.body).toMatchObject({
      tenantCount: 1,
      trialCount: 1,
      revenue: 2900,
      mrr: 2900,
      aiUsage: 100,
    });
  });

  it("decrements tenant count and increments churn on cancellation", async () => {
    const app = wirePlatformConsole();
    app.ingest("tenancy.tenant.created", {});
    app.ingest("tenancy.tenant.cancelled", {});
    const response = await app.platformConsole.getKpis();
    expect(response.body).toMatchObject({ tenantCount: 0, churnedCount: 1 });
  });
});
