import { ValueObject } from "@platform/domain";

export type ReportType = "table" | "funnel" | "cohort" | "attribution" | "custom";
export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

interface AnalyticsMetricSelectionProps {
  readonly metricRef: string;
  readonly customExpression?: string;
}

/** A report-scoped **selection** of an Analytics semantic-catalog metric — never a redefinition (D-064). */
export class AnalyticsMetricSelection extends ValueObject<AnalyticsMetricSelectionProps> {
  static create(metricRef: string, customExpression?: string): AnalyticsMetricSelection {
    return new AnalyticsMetricSelection({ metricRef, customExpression });
  }

  get metricRef(): string {
    return this.props.metricRef;
  }

  get customExpression(): string | undefined {
    return this.props.customExpression;
  }
}

interface AnalyticsDimensionSelectionProps {
  readonly dimensionRef: string;
}

/** A report-scoped selection of an Analytics semantic-catalog dimension. */
export class AnalyticsDimensionSelection extends ValueObject<AnalyticsDimensionSelectionProps> {
  static create(dimensionRef: string): AnalyticsDimensionSelection {
    return new AnalyticsDimensionSelection({ dimensionRef });
  }

  get dimensionRef(): string {
    return this.props.dimensionRef;
  }
}

interface ReportFilterProps {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: unknown;
}

/** A single report filter clause. */
export class ReportFilter extends ValueObject<ReportFilterProps> {
  static create(field: string, operator: FilterOperator, value: unknown): ReportFilter {
    return new ReportFilter({ field, operator, value });
  }

  get field(): string {
    return this.props.field;
  }

  get operator(): FilterOperator {
    return this.props.operator;
  }

  get value(): unknown {
    return this.props.value;
  }
}

interface CronScheduleProps {
  readonly expression: string;
}

/** A cron schedule for automatic report generation. */
export class CronSchedule extends ValueObject<CronScheduleProps> {
  static create(expression: string): CronSchedule {
    return new CronSchedule({ expression });
  }

  get expression(): string {
    return this.props.expression;
  }
}
