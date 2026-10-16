import type { UseCase } from "@platform/application";
import { ValidationError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import {
  validateSalesRange,
  type SalesSummary,
  type SalesSummaryInput,
  type SalesSummaryQuery,
} from "./sales-summary";

export interface GetSalesSummaryDeps {
  readonly sales: SalesSummaryQuery;
}

function isKnownTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The dashboard's sales figures for one range (Plan 3D). A read model: it validates the range and the
 * zone, then delegates to the {@link SalesSummaryQuery} (SQL in production, the in-memory repository's
 * orders offline) so both answer the same question.
 */
export class GetSalesSummary implements UseCase<SalesSummaryInput, SalesSummary, DomainError> {
  private readonly deps: GetSalesSummaryDeps;

  constructor(deps: GetSalesSummaryDeps) {
    this.deps = deps;
  }

  async execute(input: SalesSummaryInput): Promise<Result<SalesSummary, DomainError>> {
    const rangeProblem = validateSalesRange(input.from, input.to);
    if (rangeProblem !== null) {
      return err(
        new ValidationError("Invalid sales range", [{ field: "range", message: rangeProblem }]),
      );
    }
    if (!isKnownTimeZone(input.timezone)) {
      return err(
        new ValidationError("Invalid time zone", [
          { field: "timezone", message: `Unknown time zone "${input.timezone}"` },
        ]),
      );
    }
    return ok(await this.deps.sales.summarize(input));
  }
}
