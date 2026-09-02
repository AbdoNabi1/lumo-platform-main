import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { ReportingTransitioned } from "./events/reporting-transitioned.event";

export type AnalyticsReportOutcome = "succeeded" | "failed";

interface AnalyticsReportProps {
  readonly reportDefinitionRef: string;
  readonly outcome: AnalyticsReportOutcome;
  readonly resultData?: unknown;
  readonly errorMessage?: string;
  readonly generatedAt: Date;
}

/**
 * An append-only run of a `ReportDefinition`, generated through `AnalyticsQueryPort` (Sprint 5.3).
 * Write-once — a run's outcome is known at construction time, so `create` itself raises the
 * `reporting.report.<outcome>` event (unlike every other aggregate's `create`, which never raises,
 * because this aggregate has no further lifecycle to transition through).
 */
export class AnalyticsReport extends AggregateRoot<AnalyticsReportProps> {
  static recordSuccess(
    id: UniqueEntityId,
    reportDefinitionRef: string,
    resultData: unknown,
    eventId: string,
    occurredAt: Date,
  ): AnalyticsReport {
    const report = new AnalyticsReport(
      { reportDefinitionRef, outcome: "succeeded", resultData, generatedAt: occurredAt },
      id,
    );
    report.raise(eventId, occurredAt);
    return report;
  }

  static recordFailure(
    id: UniqueEntityId,
    reportDefinitionRef: string,
    errorMessage: string,
    eventId: string,
    occurredAt: Date,
  ): AnalyticsReport {
    const report = new AnalyticsReport(
      { reportDefinitionRef, outcome: "failed", errorMessage, generatedAt: occurredAt },
      id,
    );
    report.raise(eventId, occurredAt);
    return report;
  }

  /** Rebuilds a persisted run exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    reportDefinitionRef: string,
    outcome: AnalyticsReportOutcome,
    generatedAt: Date,
    version: number,
    resultData?: unknown,
    errorMessage?: string,
  ): AnalyticsReport {
    return new AnalyticsReport(
      { reportDefinitionRef, outcome, resultData, errorMessage, generatedAt },
      id,
      version,
    );
  }

  private raise(eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new ReportingTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.reportDefinitionRef,
          family: "report",
          action: this.props.outcome === "succeeded" ? "generated" : "failed",
        },
      ),
    );
  }

  get reportDefinitionRef(): string {
    return this.props.reportDefinitionRef;
  }

  get outcome(): AnalyticsReportOutcome {
    return this.props.outcome;
  }

  get resultData(): unknown {
    return this.props.resultData;
  }

  get errorMessage(): string | undefined {
    return this.props.errorMessage;
  }

  get generatedAt(): Date {
    return this.props.generatedAt;
  }
}
