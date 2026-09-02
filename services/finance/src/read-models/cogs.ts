export interface CogsReadModel {
  readonly period: string;
  readonly currency: string;
  readonly totalMinor: number;
}

export function projectCogs(totalMinor: number, period: string, currency: string): CogsReadModel {
  return { period, currency, totalMinor };
}
