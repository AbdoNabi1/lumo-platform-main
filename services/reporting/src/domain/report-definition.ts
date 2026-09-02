import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { ReportingTransitioned } from "./events/reporting-transitioned.event";
import {
  type AnalyticsDimensionSelection,
  type AnalyticsMetricSelection,
  type CronSchedule,
  type ReportFilter,
  type ReportType,
} from "./value-objects/report-selection";
import {
  canTransitionReportDefinition,
  ReportDefinitionStatus,
  type ReportDefinitionStatusValue,
} from "./value-objects/statuses";

interface ReportDefinitionProps {
  readonly name: string;
  readonly type: ReportType;
  readonly metrics: readonly AnalyticsMetricSelection[];
  readonly dimensions: readonly AnalyticsDimensionSelection[];
  readonly filters: readonly ReportFilter[];
  readonly schedule?: CronSchedule;
  status: ReportDefinitionStatus;
}

/**
 * Source of truth for a report's shape (Sprint 5.3) — table/funnel/cohort/attribution/custom.
 * References the Analytics semantic catalog by ref; never redefines a metric/dimension (D-064).
 * Owns no business entities — generation itself is `AnalyticsReport`'s job, reached through
 * `AnalyticsQueryPort`.
 */
export class ReportDefinition extends AggregateRoot<ReportDefinitionProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    type: ReportType,
    metrics: readonly AnalyticsMetricSelection[],
    dimensions: readonly AnalyticsDimensionSelection[],
    filters: readonly ReportFilter[],
    schedule?: CronSchedule,
  ): ReportDefinition {
    return new ReportDefinition(
      {
        name,
        type,
        metrics,
        dimensions,
        filters,
        schedule,
        status: ReportDefinitionStatus.draft(),
      },
      id,
    );
  }

  /** Rebuilds a persisted report definition exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    type: ReportType,
    metrics: readonly AnalyticsMetricSelection[],
    dimensions: readonly AnalyticsDimensionSelection[],
    filters: readonly ReportFilter[],
    status: ReportDefinitionStatus,
    version: number,
    schedule?: CronSchedule,
  ): ReportDefinition {
    return new ReportDefinition(
      { name, type, metrics, dimensions, filters, schedule, status },
      id,
      version,
    );
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(toStatus: ReportDefinitionStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionReportDefinition(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition report definition from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = ReportDefinitionStatus.from(toStatus);
    this.raise(toStatus, eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  private raise(action: string, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new ReportingTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          family: "report_definition",
          action,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get type(): ReportType {
    return this.props.type;
  }

  get metrics(): readonly AnalyticsMetricSelection[] {
    return this.props.metrics;
  }

  get dimensions(): readonly AnalyticsDimensionSelection[] {
    return this.props.dimensions;
  }

  get filters(): readonly ReportFilter[] {
    return this.props.filters;
  }

  get schedule(): CronSchedule | undefined {
    return this.props.schedule;
  }

  get status(): ReportDefinitionStatus {
    return this.props.status;
  }
}
