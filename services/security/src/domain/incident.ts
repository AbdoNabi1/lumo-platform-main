import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  "detected",
  "triaged",
  "mitigating",
  "resolved",
  "closed",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  detected: ["triaged", "closed"],
  triaged: ["mitigating", "closed"],
  mitigating: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

export interface TimelineEntry {
  readonly at: Date;
  readonly action: string;
  readonly note: string;
}

export interface EvidenceEntry {
  readonly at: Date;
  readonly kind: string;
  /** A reference to evidence (audit record id / hash / URL) — never the sensitive payload itself. */
  readonly ref: string;
}

interface IncidentProps {
  readonly reference: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  readonly category: string;
  readonly tenantRef: string | null;
  assignee: string | null;
  resolution: string | null;
  timeline: TimelineEntry[];
  evidence: EvidenceEntry[];
  readonly detectedAt: Date;
}

/**
 * A **security incident** (sprint P2.0-E §11) — a first-class aggregate driving the SOC lifecycle:
 * detection → triage → mitigation → resolution → closure, with an append-only **timeline** and
 * tamper-evidence **evidence** references (to WORM audit records, never the payload). Severity and
 * status are read-model + Trust Center inputs. Every transition is WORM-audited.
 */
export class Incident extends AggregateRoot<IncidentProps> {
  static open(
    id: UniqueEntityId,
    input: {
      readonly reference: string;
      readonly title: string;
      readonly severity: IncidentSeverity;
      readonly category: string;
      readonly tenantRef?: string | null;
    },
    eventId: string,
    occurredAt: Date,
  ): Incident {
    if (input.reference.trim().length === 0)
      throw new BusinessRuleError("An incident needs a reference");
    if (input.title.trim().length === 0) throw new BusinessRuleError("An incident needs a title");
    const incident = new Incident(
      {
        reference: input.reference.trim(),
        title: input.title.trim(),
        severity: input.severity,
        status: "detected",
        category: input.category,
        tenantRef: input.tenantRef ?? null,
        assignee: null,
        resolution: null,
        timeline: [{ at: occurredAt, action: "detected", note: input.title.trim() }],
        evidence: [],
        detectedAt: occurredAt,
      },
      id,
    );
    incident.emit("security.incident.opened", eventId, occurredAt);
    return incident;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: IncidentProps & { readonly version: number },
  ): Incident {
    return new Incident(
      { ...base, timeline: [...base.timeline], evidence: [...base.evidence] },
      id,
      base.version,
    );
  }

  triage(assignee: string, note: string, eventId: string, occurredAt: Date): void {
    this.transition("triaged", "security.incident.triaged", "triage", note, occurredAt, eventId);
    this.props.assignee = assignee;
  }

  mitigate(note: string, eventId: string, occurredAt: Date): void {
    this.transition(
      "mitigating",
      "security.incident.mitigated",
      "mitigate",
      note,
      occurredAt,
      eventId,
    );
  }

  resolve(resolution: string, eventId: string, occurredAt: Date): void {
    this.transition(
      "resolved",
      "security.incident.resolved",
      "resolve",
      resolution,
      occurredAt,
      eventId,
    );
    this.props.resolution = resolution;
  }

  close(note: string, eventId: string, occurredAt: Date): void {
    this.transition("closed", "security.incident.closed", "close", note, occurredAt, eventId);
  }

  addEvidence(kind: string, ref: string, eventId: string, occurredAt: Date): void {
    if (this.props.status === "closed")
      throw new BusinessRuleError("Cannot add evidence to a closed incident");
    this.props.evidence = [...this.props.evidence, { at: occurredAt, kind, ref }];
    this.props.timeline = [
      ...this.props.timeline,
      { at: occurredAt, action: "evidence", note: `${kind}:${ref}` },
    ];
    this.emit("security.incident.evidence_added", eventId, occurredAt);
  }

  get reference(): string {
    return this.props.reference;
  }
  get title(): string {
    return this.props.title;
  }
  get severity(): IncidentSeverity {
    return this.props.severity;
  }
  get status(): IncidentStatus {
    return this.props.status;
  }
  get category(): string {
    return this.props.category;
  }
  get tenantRef(): string | null {
    return this.props.tenantRef;
  }
  get assignee(): string | null {
    return this.props.assignee;
  }
  get resolution(): string | null {
    return this.props.resolution;
  }
  get timeline(): readonly TimelineEntry[] {
    return this.props.timeline;
  }
  get evidence(): readonly EvidenceEntry[] {
    return this.props.evidence;
  }
  get isOpen(): boolean {
    return this.props.status !== "closed" && this.props.status !== "resolved";
  }
  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  private transition(
    to: IncidentStatus,
    event: SecurityEventName,
    action: string,
    note: string,
    occurredAt: Date,
    eventId: string,
  ): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new BusinessRuleError(
        `Incident cannot transition from "${this.props.status}" to "${to}"`,
      );
    }
    this.props.status = to;
    this.props.timeline = [...this.props.timeline, { at: occurredAt, action, note }];
    this.emit(event, eventId, occurredAt);
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "incident",
          key: this.props.reference,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
