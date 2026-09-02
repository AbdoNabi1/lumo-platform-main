import type { AiForecastPort, ForecastProposal } from "../application/ports";

/**
 * Deterministic offline stand-in for real AI forecasting (deferred long-tail, design §14/§15).
 * Always proposes zero — a placeholder adapter, never applied (`applied: false`), so it can never
 * silently masquerade as a real forecast.
 */
export class InMemoryAiForecast implements AiForecastPort {
  async propose(
    figure: string,
    currency: string,
    horizonPeriods: number,
  ): Promise<ForecastProposal> {
    return {
      period: `+${horizonPeriods}`,
      figure,
      proposedMinor: 0,
      currency,
      applied: false,
    };
  }
}
