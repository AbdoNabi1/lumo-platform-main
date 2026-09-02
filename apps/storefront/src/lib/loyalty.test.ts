import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoyaltyAccountSummary } from "./runtime-api";

const getMyLoyaltyBalance =
  vi.fn<() => Promise<{ status: number; body: LoyaltyAccountSummary | null }>>();

vi.mock("./runtime-api", () => ({
  getMyLoyaltyBalance: () => getMyLoyaltyBalance(),
}));

const { resolveMyLoyaltyBalance } = await import("./loyalty");

beforeEach(() => {
  getMyLoyaltyBalance.mockReset();
});

const account: LoyaltyAccountSummary = {
  id: "account-1",
  status: "active",
  balance: 150,
  tierName: "bronze",
  transactions: [
    {
      id: "txn-1",
      idempotencyKey: "earn-1",
      kind: "earn",
      pointsDelta: 150,
      ref: "order-1",
      occurredAt: "2026-08-31T00:00:00.000Z",
    },
  ],
};

describe("resolveMyLoyaltyBalance", () => {
  it("resolves a valid session to the account balance the SERVER returned", async () => {
    getMyLoyaltyBalance.mockResolvedValue({ status: 200, body: account });

    expect(await resolveMyLoyaltyBalance("session-1")).toEqual({ status: "ok", account });
  });

  it("never calls the API when there is no cookie — a signed-out view costs no round trip", async () => {
    expect(await resolveMyLoyaltyBalance(undefined)).toEqual({ status: "signed-out" });
    expect(await resolveMyLoyaltyBalance("")).toEqual({ status: "signed-out" });
    expect(getMyLoyaltyBalance).not.toHaveBeenCalled();
  });

  it("treats a cookie the SERVER refused as signed out — presence is never proof", async () => {
    getMyLoyaltyBalance.mockResolvedValue({ status: 401, body: null });

    expect(await resolveMyLoyaltyBalance("forged-or-revoked")).toEqual({ status: "signed-out" });
    expect(getMyLoyaltyBalance).toHaveBeenCalledTimes(1);
  });

  it("reports `no-account` for a 404 — a real state, never a fabricated zero balance", async () => {
    getMyLoyaltyBalance.mockResolvedValue({ status: 404, body: null });

    expect(await resolveMyLoyaltyBalance("session-1")).toEqual({ status: "no-account" });
  });

  it("reports a transport failure as `error`, NOT as signed out or no-account", async () => {
    getMyLoyaltyBalance.mockResolvedValue({ status: 0, body: null });
    expect(await resolveMyLoyaltyBalance("session-1")).toEqual({ status: "error" });

    getMyLoyaltyBalance.mockResolvedValue({ status: 500, body: null });
    expect(await resolveMyLoyaltyBalance("session-1")).toEqual({ status: "error" });
  });

  it("reports `error` for a 2xx with no body rather than inventing a balance", async () => {
    getMyLoyaltyBalance.mockResolvedValue({ status: 200, body: null });
    expect(await resolveMyLoyaltyBalance("session-1")).toEqual({ status: "error" });
  });
});
