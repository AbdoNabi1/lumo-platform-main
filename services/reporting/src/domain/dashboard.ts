import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { ReportingTransitioned } from "./events/reporting-transitioned.event";
import {
  canTransitionDashboard,
  DashboardStatus,
  type DashboardStatusValue,
} from "./value-objects/statuses";

interface DashboardProps {
  readonly name: string;
  readonly tileRefs: readonly string[];
  status: DashboardStatus;
}

/** Source of truth for a dashboard's tile layout (Sprint 5.3) — tiles are bare `ReportDefinition` refs, no business entities owned here. */
export class Dashboard extends AggregateRoot<DashboardProps> {
  static create(id: UniqueEntityId, name: string, tileRefs: readonly string[]): Dashboard {
    return new Dashboard({ name, tileRefs, status: DashboardStatus.active() }, id);
  }

  /** Rebuilds a persisted dashboard exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    tileRefs: readonly string[],
    status: DashboardStatus,
    version: number,
  ): Dashboard {
    return new Dashboard({ name, tileRefs, status }, id, version);
  }

  /** The generic, validated status transition — `archive`/`reactivate` delegate to this. */
  transition(toStatus: DashboardStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionDashboard(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition dashboard from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = DashboardStatus.from(toStatus);
    const action = toStatus === "active" ? "reactivated" : "archived";
    this.addDomainEvent(
      new ReportingTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          family: "dashboard",
          action,
        },
      ),
    );
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  reactivate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  get name(): string {
    return this.props.name;
  }

  get tileRefs(): readonly string[] {
    return this.props.tileRefs;
  }

  get status(): DashboardStatus {
    return this.props.status;
  }
}
