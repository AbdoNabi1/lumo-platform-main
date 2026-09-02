export interface CashFlowReadModel {
  readonly period: string;
  readonly currency: string;
  readonly netMinor: number;
}

export function projectCashFlow(
  netMinor: number,
  period: string,
  currency: string,
): CashFlowReadModel {
  return { period, currency, netMinor };
}
