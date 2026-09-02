import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { Incident, type IncidentSeverity } from "../domain/incident";
import { recordAudit, type SecurityDeps } from "./deps";

export interface IncidentOutput {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly category: string;
  readonly assignee: string | null;
  readonly timelineEntries: number;
  readonly evidenceCount: number;
}

function present(i: Incident): IncidentOutput {
  return {
    id: i.id.toString(),
    reference: i.reference,
    title: i.title,
    severity: i.severity,
    status: i.status,
    category: i.category,
    assignee: i.assignee,
    timelineEntries: i.timeline.length,
    evidenceCount: i.evidence.length,
  };
}

export interface OpenIncidentInput {
  readonly title: string;
  readonly severity: IncidentSeverity;
  readonly category: string;
  readonly reference?: string;
  readonly tenantRef?: string | null;
}

/** Opens a security incident (detection). Emits `security.incident.opened` + audit. */
export class OpenIncident implements UseCase<OpenIncidentInput, IncidentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: OpenIncidentInput): Promise<Result<IncidentOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<IncidentOutput, DomainError>>(async (tx) => {
      const reference = input.reference ?? `INC-${this.deps.idGenerator.generate()}`;
      const existing = await this.deps.incidents.findByReference(reference, tx);
      if (existing !== null) return ok(present(existing));
      let incident: Incident;
      try {
        incident = Incident.open(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            reference,
            title: input.title,
            severity: input.severity,
            category: input.category,
            tenantRef: input.tenantRef ?? null,
          },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.incidents.save(incident, tx);
      await recordAudit(this.deps, tx, {
        principalRef: "system",
        action: "security.incident.opened",
        decision: "review",
        tenantRef: input.tenantRef ?? null,
        metadata: { reference, severity: input.severity, category: input.category },
      });
      return ok(present(incident));
    });
  }
}

type IncidentMutation = (incident: Incident, eventId: string, now: Date) => void;

async function advance(
  deps: SecurityDeps,
  reference: string,
  action: string,
  mutate: IncidentMutation,
): Promise<Result<IncidentOutput, DomainError>> {
  return deps.unitOfWork.run<Result<IncidentOutput, DomainError>>(async (tx) => {
    const incident = await deps.incidents.findByReference(reference, tx);
    if (incident === null) return err(new NotFoundError("Incident not found"));
    try {
      mutate(incident, deps.idGenerator.generate(), deps.clock.now());
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
    await deps.incidents.save(incident, tx);
    await recordAudit(deps, tx, {
      principalRef: "system",
      action,
      decision: "allow",
      tenantRef: incident.tenantRef,
      metadata: { reference, status: incident.status },
    });
    return ok(present(incident));
  });
}

export interface TriageIncidentInput {
  readonly reference: string;
  readonly assignee: string;
  readonly note: string;
}
/** Triages an incident (assigns an owner). Emits `security.incident.triaged`. */
export class TriageIncident implements UseCase<TriageIncidentInput, IncidentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: TriageIncidentInput): Promise<Result<IncidentOutput, DomainError>> {
    return advance(this.deps, input.reference, "security.incident.triaged", (i, e, n) =>
      i.triage(input.assignee, input.note, e, n),
    );
  }
}

export interface IncidentNoteInput {
  readonly reference: string;
  readonly note: string;
}
/** Marks an incident as being mitigated. Emits `security.incident.mitigated`. */
export class MitigateIncident implements UseCase<IncidentNoteInput, IncidentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: IncidentNoteInput): Promise<Result<IncidentOutput, DomainError>> {
    return advance(this.deps, input.reference, "security.incident.mitigated", (i, e, n) =>
      i.mitigate(input.note, e, n),
    );
  }
}

export interface ResolveIncidentInput {
  readonly reference: string;
  readonly resolution: string;
}
/** Resolves an incident. Emits `security.incident.resolved`. */
export class ResolveIncident implements UseCase<ResolveIncidentInput, IncidentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: ResolveIncidentInput): Promise<Result<IncidentOutput, DomainError>> {
    return advance(this.deps, input.reference, "security.incident.resolved", (i, e, n) =>
      i.resolve(input.resolution, e, n),
    );
  }
}

/** Closes an incident (post-mortem complete). Emits `security.incident.closed`. */
export class CloseIncident implements UseCase<IncidentNoteInput, IncidentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: IncidentNoteInput): Promise<Result<IncidentOutput, DomainError>> {
    return advance(this.deps, input.reference, "security.incident.closed", (i, e, n) =>
      i.close(input.note, e, n),
    );
  }
}

export interface AddIncidentEvidenceInput {
  readonly reference: string;
  readonly kind: string;
  readonly ref: string;
}
/** Attaches an evidence reference (e.g. a WORM audit record id) to an incident. */
export class AddIncidentEvidence implements UseCase<
  AddIncidentEvidenceInput,
  IncidentOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: AddIncidentEvidenceInput): Promise<Result<IncidentOutput, DomainError>> {
    return advance(this.deps, input.reference, "security.incident.evidence_added", (i, e, n) =>
      i.addEvidence(input.kind, input.ref, e, n),
    );
  }
}
