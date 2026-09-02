export interface TaxReadModel {
  readonly period: string;
  readonly currency: string;
  readonly jurisdiction: string;
  readonly baseMinor: number;
  readonly taxMinor: number;
}

export function projectTax(
  jurisdiction: string,
  baseMinor: number,
  taxMinor: number,
  period: string,
  currency: string,
): TaxReadModel {
  return { period, currency, jurisdiction, baseMinor, taxMinor };
}
