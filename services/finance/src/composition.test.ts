import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { JsonEventSerializer } from "@platform/domain-events";
import { beforeEach, describe, expect, it } from "vitest";
import { wireFinance, type WiredFinance } from "./composition";
import type { PostingAccounts } from "./domain/services/ledger-poster";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-07-11T00:00:00Z");
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  generate(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

const POSTING_ACCOUNTS: PostingAccounts = {
  revenue: "4000-REVENUE",
  receivable: "1200-AR",
  cogs: "5000-COGS",
  inventory: "1300-INVENTORY",
  refundContra: "4900-REFUNDS",
  expense: "6000-EXPENSES",
  cash: "1000-CASH",
  fees: "6100-FEES",
};

const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["finance:manage", "finance:read"],
};
const stranger: Principal = { id: "guest-1", kind: "customer", roles: [] };

function wire(): WiredFinance {
  return wireFinance({
    serializer: new JsonEventSerializer(),
    idGenerator: new SequentialIdGenerator(),
    clock: new FixedClock(),
    postingAccounts: POSTING_ACCOUNTS,
  });
}

describe("wireFinance", () => {
  let finance: WiredFinance;

  beforeEach(() => {
    finance = wire();
  });

  it("creates an account for an authorized principal", async () => {
    const response = await finance.finance.createAccount({
      principal: staff,
      code: "1200-AR",
      name: "Accounts Receivable",
      type: "asset",
    });
    expect(response.status).toBe(201);
  });

  it("denies an unauthorized principal and still audits the decision", async () => {
    const response = await finance.finance.createAccount({
      principal: stranger,
      code: "1200-AR",
      name: "Accounts Receivable",
      type: "asset",
    });
    expect(response.status).toBe(403);
    expect(finance.security.audit.some((event) => event.decision === "deny")).toBe(true);
  });

  it("denies a step-up command until the principal steps up", async () => {
    const denied = await finance.finance.recordManualAdjustment({
      principal: staff,
      sourceRef: "manual:1",
      debitAccountRef: "6000-EXPENSES",
      creditAccountRef: "1000-CASH",
      amountMinor: 500,
      currency: "USD",
    });
    expect(denied.status).toBe(403);

    finance.security.markSteppedUp(staff.id);
    const allowed = await finance.finance.recordManualAdjustment({
      principal: staff,
      sourceRef: "manual:1",
      debitAccountRef: "6000-EXPENSES",
      creditAccountRef: "1000-CASH",
      amountMinor: 500,
      currency: "USD",
    });
    expect(allowed.status).toBe(201);
  });

  it("round-trips through create -> trial balance -> read-model query", async () => {
    await finance.finance.createBudget({
      principal: staff,
      costCenterRef: "cc-1",
      period: "2026-07",
      amountMinor: 100_000,
      currency: "USD",
    });

    finance.security.markSteppedUp(staff.id);
    const posted = await finance.finance.recordManualAdjustment({
      principal: staff,
      sourceRef: "manual:2",
      debitAccountRef: "6000-EXPENSES",
      creditAccountRef: "1000-CASH",
      amountMinor: 250,
      currency: "USD",
    });
    expect(posted.status).toBe(201);

    const trialBalance = await finance.finance.trialBalance({
      principal: staff,
      startDate: new Date("2026-07-01T00:00:00Z"),
      endDate: new Date("2026-07-31T23:59:59Z"),
      currency: "USD",
    });
    expect(trialBalance.status).toBe(200);
    expect((trialBalance.body as { rows: unknown[] }).rows.length).toBeGreaterThan(0);

    const published = await finance.drainOutbox();
    expect(published).toBeGreaterThan(0);
  });

  it("rejects a forecast request without finance:read", async () => {
    const response = await finance.finance.generateForecast({
      principal: stranger,
      figure: "revenue",
      currency: "USD",
      horizonPeriods: 3,
    });
    expect(response.status).toBe(403);
  });

  it("proposes-only forecasts are never applied", async () => {
    const response = await finance.finance.generateForecast({
      principal: staff,
      figure: "revenue",
      currency: "USD",
      horizonPeriods: 3,
    });
    expect(response.status).toBe(200);
    expect((response.body as { applied: boolean }).applied).toBe(false);
  });
});
